-- ===========================================================================
-- Migration 098 — Stays & Homestays: weekly host settlements
--
-- When a traveller pays 100% online (pay_mode = 'full'), Andaman Go is
-- holding the host's ~80% share until it's paid out — there is no
-- automated payout in this codebase (lib/admin-revenue.ts's own header
-- says so: "no payment system yet, no deposits, no settlement, no
-- payouts" even though Razorpay itself is wired). This migration is that
-- settlement layer, scoped to stays only:
--
--   * stay_settlement_batches — one row per (partner, period), the money
--     owed and its paid/pending status.
--   * stay_settlement_items   — one row per booking_item that batch pays
--     out, so the total is always auditable back to real bookings.
--
-- Eligibility is by DEPARTURE, not by booking date: a booking only becomes
-- settleable once its check-out date has passed, so a booking cancelled or
-- refunded before the guest ever checks in can never be wrongly paid out.
--
-- Trigger is admin-initiated ("run this week's settlement"), not a cron —
-- nothing in this codebase runs a scheduled job today, and every other
-- money-adjacent screen (lib/admin-revenue.ts) is already a manual, admin-
-- read report. Marking a batch paid records a bank reference the admin
-- typed in after wiring the money by hand outside the app — there is no
-- Razorpay Route/automated vendor payout here (that needs per-host KYC
-- onboarding, real new scope, not a fit for this migration).
--
-- Safe to run more than once.
-- ===========================================================================


create table if not exists stay_settlement_batches (
  id                 uuid primary key default gen_random_uuid(),
  partner_id         uuid not null references partners(id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  status             text not null default 'pending' check (status in ('pending','paid')),
  gross_paise        int not null default 0,
  commission_paise   int not null default 0,
  net_payable_paise  int not null default 0,
  item_count         int not null default 0,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  paid_by            uuid references auth.users(id),
  payout_reference   text,
  payout_note        text,
  unique (partner_id, period_start)
);

create index if not exists stay_settlement_batches_partner_idx
  on stay_settlement_batches (partner_id, status);

create table if not exists stay_settlement_items (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references stay_settlement_batches(id) on delete cascade,
  booking_item_id  uuid not null references booking_items(id),
  price_paise      int not null,
  commission_bps   int not null,
  commission_paise int not null,
  net_paise        int not null,
  created_at       timestamptz not null default now(),
  unique (booking_item_id)
);

create index if not exists stay_settlement_items_batch_idx on stay_settlement_items (batch_id);


-- ---------------------------------------------------------------------------
-- RLS — a partner sees its own batches/items; admins see all; no direct
-- insert/update/delete policy — every write goes through the two RPCs below.
-- ---------------------------------------------------------------------------

alter table stay_settlement_batches enable row level security;
alter table stay_settlement_items   enable row level security;

drop policy if exists "partner sees own stay settlement batches" on stay_settlement_batches;
create policy "partner sees own stay settlement batches" on stay_settlement_batches
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid() and pu.partner_id = stay_settlement_batches.partner_id
    )
  );

drop policy if exists "admins see all stay settlement batches" on stay_settlement_batches;
create policy "admins see all stay settlement batches" on stay_settlement_batches
  for select using (is_admin());

drop policy if exists "partner sees own stay settlement items" on stay_settlement_items;
create policy "partner sees own stay settlement items" on stay_settlement_items
  for select using (
    exists (
      select 1 from stay_settlement_batches b
      join partner_users pu on pu.partner_id = b.partner_id
      where b.id = stay_settlement_items.batch_id and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all stay settlement items" on stay_settlement_items;
create policy "admins see all stay settlement items" on stay_settlement_items
  for select using (is_admin());

grant select on stay_settlement_batches, stay_settlement_items to authenticated;


-- ---------------------------------------------------------------------------
-- run_stay_settlement — admin-triggered. For every partner with at least
-- one eligible booking_item in the window, inserts one batch + its items.
-- Eligible = kind='stay', pay_mode='full' (the platform is actually holding
-- money), state confirmed/completed, checked out on or before yesterday
-- (IST), and not already in any settlement batch.
-- ---------------------------------------------------------------------------

create or replace function run_stay_settlement(p_period_start date, p_period_end date)
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
    where bi.kind = 'stay'
      and bi.pay_mode = 'full'
      and bi.state in ('confirmed', 'completed')
      and ((bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units) <= (now() at time zone 'Asia/Kolkata')::date
      and ((bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units) between p_period_start and p_period_end
      and not exists (select 1 from stay_settlement_items si where si.booking_item_id = bi.id)
  loop
    declare
      v_batch uuid;
      v_gross int;
      v_commission int;
      v_net int;
      v_count int;
      v_bps int;
    begin
      select bps into v_bps from commission_rates where kind = 'stay';
      v_bps := coalesce(v_bps, 2000);

      insert into stay_settlement_batches (partner_id, period_start, period_end)
      values (v_partner, p_period_start, p_period_end)
      on conflict (partner_id, period_start) do update set period_end = excluded.period_end
      returning id into v_batch;

      insert into stay_settlement_items (batch_id, booking_item_id, price_paise, commission_bps, commission_paise, net_paise)
      select
        v_batch, bi.id, bi.price_paise, v_bps,
        round(bi.price_paise * v_bps / 10000.0)::int,
        bi.price_paise - round(bi.price_paise * v_bps / 10000.0)::int
      from booking_items bi
      where bi.kind = 'stay'
        and bi.partner_id = v_partner
        and bi.pay_mode = 'full'
        and bi.state in ('confirmed', 'completed')
        and ((bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units) <= (now() at time zone 'Asia/Kolkata')::date
        and ((bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units) between p_period_start and p_period_end
        and not exists (select 1 from stay_settlement_items si where si.booking_item_id = bi.id)
      on conflict (booking_item_id) do nothing;

      select count(*), coalesce(sum(price_paise), 0), coalesce(sum(commission_paise), 0), coalesce(sum(net_paise), 0)
        into v_count, v_gross, v_commission, v_net
      from stay_settlement_items where batch_id = v_batch;

      update stay_settlement_batches set
        gross_paise = v_gross, commission_paise = v_commission,
        net_payable_paise = v_net, item_count = v_count
      where id = v_batch;

      return query select v_partner, v_count, v_net;
    end;
  end loop;
end $$;

revoke all on function run_stay_settlement(date, date) from public;
grant execute on function run_stay_settlement(date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- mark_stay_settlement_paid — admin records that the bank transfer already
-- happened outside the app.
-- ---------------------------------------------------------------------------

create or replace function mark_stay_settlement_paid(
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

  select status into v_status from stay_settlement_batches where id = p_batch_id for update;
  if v_status is null then
    return query select false, 'That settlement batch no longer exists.'::text;
    return;
  end if;
  if v_status = 'paid' then
    return query select false, 'That batch is already marked paid.'::text;
    return;
  end if;

  update stay_settlement_batches set
    status = 'paid', paid_at = now(), paid_by = auth.uid(),
    payout_reference = trim(p_reference), payout_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_batch_id;

  return query select true, 'Marked paid.'::text;
end $$;

revoke all on function mark_stay_settlement_paid(uuid, text, text) from public;
grant execute on function mark_stay_settlement_paid(uuid, text, text) to authenticated;


select 'stay settlements installed' as done;
