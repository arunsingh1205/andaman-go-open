-- ===========================================================================
-- Migration 101 — weekly settlement, every category, not just stays
--
-- 098 built the weekly settlement batch/mark-paid mechanism for stays only.
-- Feedback: every category that collects money online on the partner's
-- behalf (not just stays) needs the same weekly settlement — an activity or
-- trip booked 'full' or 'deposit' online is exactly the same "Andaman Go is
-- holding money that belongs to the partner" situation a fully-paid stay is.
--
-- Rather than bolt a second, parallel settlement system on top of the first,
-- this migration REPLACES the stay-only tables/RPCs with generic ones and
-- reuses the exact "what's actually owed" math lib/admin-revenue.ts already
-- established — this is that same logic, turned into something that can
-- actually be run as a batch and marked paid, instead of only ever read:
--
--   * "delivered" — redeemed_at is set (every kind, including a stay, checks
--     in through the same generic redemption flow). Owed = the price minus
--     commission, minus whatever the partner already collected in cash at
--     the counter (the balance on a 'deposit' or 'partial' booking —
--     'partial' bookings always net to owed = 0, since the cash-collected
--     balance already equals the whole commission-deducted net).
--   * "cancelled, but retained money" — state='refunded', money was kept
--     (a forfeited deposit, or the half kept on a full-payment cancellation,
--     050/036) and nothing was ever collected at a counter, so the whole
--     retained amount minus commission is owed.
--
-- Both buckets read booking_items directly (not admin_bookings — this is an
-- admin-gated SECURITY DEFINER function, so it doesn't need the view's own
-- is_admin() gate or its RLS-shaped join).
--
-- The stay_settlement_* tables/RPCs from 098 are dropped outright rather
-- than migrated — there is no real settlement data yet (098 shipped minutes
-- before this migration, in the same session), so there is nothing to carry
-- over.
--
-- Safe to run more than once.
-- ===========================================================================


drop function if exists run_stay_settlement(date, date);
drop function if exists mark_stay_settlement_paid(uuid, text, text);
drop table if exists stay_settlement_items cascade;
drop table if exists stay_settlement_batches cascade;


create table settlement_batches (
  id                   uuid primary key default gen_random_uuid(),
  partner_id           uuid not null references partners(id) on delete cascade,
  period_start         date not null,
  period_end           date not null,
  status               text not null default 'pending' check (status in ('pending','paid')),
  gross_paise          int not null default 0,
  commission_paise     int not null default 0,
  cash_collected_paise int not null default 0,
  net_payable_paise    int not null default 0,
  item_count           int not null default 0,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz,
  paid_by              uuid references auth.users(id),
  payout_reference     text,
  payout_note          text,
  unique (partner_id, period_start)
);

create index settlement_batches_partner_idx on settlement_batches (partner_id, status);

create table settlement_items (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references settlement_batches(id) on delete cascade,
  booking_item_id      uuid not null references booking_items(id),
  kind                 text not null,
  -- 'delivered' (redeemed_at set) or 'cancelled_retained' (refunded but kept
  -- some money) — which of admin-revenue's two buckets this row came from.
  event                text not null check (event in ('delivered','cancelled_retained')),
  gross_paise          int not null,
  commission_bps       int not null,
  commission_paise     int not null,
  cash_collected_paise int not null default 0,
  net_payable_paise    int not null,
  created_at           timestamptz not null default now(),
  unique (booking_item_id)
);

create index settlement_items_batch_idx on settlement_items (batch_id);

alter table settlement_batches enable row level security;
alter table settlement_items   enable row level security;

create policy "partner sees own settlement batches" on settlement_batches
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid() and pu.partner_id = settlement_batches.partner_id
    )
  );

create policy "admins see all settlement batches" on settlement_batches
  for select using (is_admin());

create policy "partner sees own settlement items" on settlement_items
  for select using (
    exists (
      select 1 from settlement_batches b
      join partner_users pu on pu.partner_id = b.partner_id
      where b.id = settlement_items.batch_id and pu.user_id = auth.uid()
    )
  );

create policy "admins see all settlement items" on settlement_items
  for select using (is_admin());

grant select on settlement_batches, settlement_items to authenticated;


-- ---------------------------------------------------------------------------
-- run_settlement — admin-triggered, every category. For every partner with
-- at least one eligible booking_item in the window, inserts one batch + its
-- items. Re-runnable: already-settled items are excluded by the
-- `not exists (... settlement_items ...)` guard, and an existing batch for
-- the same (partner, period_start) just gets more items added and its
-- totals recomputed.
--
-- The eligible/priced CTE computes each row's numbers exactly once (is_
-- delivered, gross, commission, cash collected, net owed) so the "which
-- bucket, what counts as gross" decision can't drift between the partner
-- list, the insert, and the totals the way four repeated CASE expressions
-- risked.
-- ---------------------------------------------------------------------------

create or replace function run_settlement(p_period_start date, p_period_end date)
returns table (partner_id uuid, items_settled int, net_payable_paise int)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid settlement period' using errcode = '22023';
  end if;

  for v_partner in
    select distinct bi.partner_id
    from booking_items bi
    where bi.pay_mode in ('full', 'deposit')
      and not exists (select 1 from settlement_items si where si.booking_item_id = bi.id)
      and (
        (
          bi.redeemed_at is not null
          and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
        )
        or (
          bi.state = 'refunded' and bi.cancelled_at is not null
          and coalesce(bi.paid_online_paise, 0) > coalesce(bi.refunded_paise, 0)
          and (bi.cancelled_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
        )
      )
  loop
    declare
      v_batch uuid;
      v_gross int;
      v_commission int;
      v_cash int;
      v_net int;
      v_count int;
    begin
      insert into settlement_batches (partner_id, period_start, period_end)
      values (v_partner, p_period_start, p_period_end)
      on conflict (partner_id, period_start) do update set period_end = excluded.period_end
      returning id into v_batch;

      -- `base` computes each row's facts exactly once (is it a delivery-in-
      -- window or a retained-cancellation-in-window, and the plain numbers
      -- either path needs); `elig` derives event/gross/commission/cash from
      -- those facts once each. Commission is always computed against the
      -- booking's real price_paise (minus any rental delivery add-on) —
      -- never against the retained slice — matching lib/admin-revenue.ts's
      -- own established math exactly, for both buckets.
      insert into settlement_items (
        batch_id, booking_item_id, kind, event, gross_paise,
        commission_bps, commission_paise, cash_collected_paise, net_payable_paise
      )
      select
        v_batch, elig.id, elig.kind, elig.event, elig.gross_paise,
        elig.bps, elig.commission_paise, elig.cash_paise,
        greatest(0, elig.gross_paise - elig.commission_paise - elig.cash_paise)
      from (
        select
          base.id, base.kind,
          case when base.is_delivered then 'delivered' else 'cancelled_retained' end as event,
          case when base.is_delivered then base.price_paise else base.retained end as gross_paise,
          base.bps,
          round(greatest(0, base.price_paise - base.delivery_paise) * base.bps / 10000.0)::int
            as commission_paise,
          case when base.is_delivered and base.pay_mode <> 'full' then base.balance_paise else 0 end
            as cash_paise
        from (
          select
            bi.id, bi.kind, bi.pay_mode, bi.price_paise,
            coalesce(bi.delivery_paise, 0) as delivery_paise,
            coalesce(bi.balance_paise, 0)  as balance_paise,
            coalesce(bi.paid_online_paise, 0) - coalesce(bi.refunded_paise, 0) as retained,
            coalesce(cr.bps, 0) as bps,
            (
              bi.redeemed_at is not null
              and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
            ) as is_delivered
          from booking_items bi
          left join commission_rates cr on cr.kind = bi.kind
          where bi.partner_id = v_partner
            and bi.pay_mode in ('full', 'deposit')
            and not exists (select 1 from settlement_items si where si.booking_item_id = bi.id)
            and (
              (
                bi.redeemed_at is not null
                and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
              )
              or (
                bi.state = 'refunded' and bi.cancelled_at is not null
                and coalesce(bi.paid_online_paise, 0) > coalesce(bi.refunded_paise, 0)
                and (bi.cancelled_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
              )
            )
        ) base
      ) elig
      on conflict (booking_item_id) do nothing;

      select
        count(*), coalesce(sum(gross_paise), 0), coalesce(sum(commission_paise), 0),
        coalesce(sum(cash_collected_paise), 0), coalesce(sum(net_payable_paise), 0)
        into v_count, v_gross, v_commission, v_cash, v_net
      from settlement_items where batch_id = v_batch;

      update settlement_batches set
        gross_paise = v_gross, commission_paise = v_commission,
        cash_collected_paise = v_cash, net_payable_paise = v_net, item_count = v_count
      where id = v_batch;

      return query select v_partner, v_count, v_net;
    end;
  end loop;
end $$;

revoke all on function run_settlement(date, date) from public;
grant execute on function run_settlement(date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- mark_settlement_paid — admin records that the bank transfer already
-- happened outside the app. Body carried over unchanged from
-- mark_stay_settlement_paid (098).
-- ---------------------------------------------------------------------------

create or replace function mark_settlement_paid(
  p_batch_id uuid, p_reference text, p_note text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reference), '') = '' then
    return query select false, 'Add a bank/UPI reference before marking this paid.'::text;
    return;
  end if;

  select status into v_status from settlement_batches where id = p_batch_id for update;
  if v_status is null then
    return query select false, 'That settlement batch no longer exists.'::text;
    return;
  end if;
  if v_status = 'paid' then
    return query select false, 'That batch is already marked paid.'::text;
    return;
  end if;

  update settlement_batches set
    status = 'paid', paid_at = now(), paid_by = auth.uid(),
    payout_reference = trim(p_reference), payout_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_batch_id;

  return query select true, 'Marked paid.'::text;
end $$;

revoke all on function mark_settlement_paid(uuid, text, text) from public;
grant execute on function mark_settlement_paid(uuid, text, text) to authenticated;


select 'settlements now cover every category' as done;
