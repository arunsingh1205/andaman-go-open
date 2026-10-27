-- ===========================================================================
-- Migration 105 — a weekly auto-run for settlements, and the two emails a
-- partner should get: "your settlement is ready" and "you've been paid"
--
-- This does NOT move money automatically — there's no RazorpayX (payouts)
-- account behind this app yet, so the bank/UPI transfer stays a manual step
-- an admin does outside the app, same as before. What this adds:
--
--   1. run_settlement's body moves into run_settlement_impl(), unguarded, so
--      it can be called from two different gates: the existing admin RPC
--      (run_settlement, unchanged behaviour) and a new cron-only entry point.
--   2. run_settlement_cron(period_start, period_end, secret) — checked
--      against a value in Supabase Vault (name 'cron_secret', seeded once,
--      out of band, never in this file) instead of is_admin(), since a
--      Vercel Cron hit has no admin session. Granted to anon, the same
--      "the secret is the only gate, not RLS" shape as the Razorpay webhook
--      route and the partner API keys (067, 099) — and it returns each
--      affected partner's owner email + name right in the result, since a
--      cron-triggered Node route has no session to look that up through
--      RLS either.
--   3. mark_settlement_paid now also returns the owner's email, the
--      partner's name, and the net amount/reference — the Node side
--      (lib/admin-settlements.ts) uses that to actually send the "you've
--      been paid" email right after an admin confirms the transfer. Its
--      RETURNS TABLE gained columns, so (like 103's create_stay_booking)
--      it has to be dropped and recreated rather than replaced.
--
-- Safe to run more than once (except the DROP, which is itself idempotent —
-- "drop function if exists").
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. run_settlement_impl — exactly run_settlement's old body, is_admin()
--    check removed. run_settlement itself becomes a two-line wrapper so the
--    admin UI's behaviour is completely unchanged.
-- ---------------------------------------------------------------------------

create or replace function run_settlement_impl(p_period_start date, p_period_end date)
returns table (partner_id uuid, items_settled int, net_payable_paise int)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
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

revoke all on function run_settlement_impl(date, date) from public;

create or replace function run_settlement(p_period_start date, p_period_end date)
returns table (partner_id uuid, items_settled int, net_payable_paise int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  return query select * from run_settlement_impl(p_period_start, p_period_end);
end $$;

revoke all on function run_settlement(date, date) from public;
grant execute on function run_settlement(date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. run_settlement_cron — same computation, gated by a Vault secret instead
--    of an admin session, and it hands back what the Vercel cron route needs
--    to send the "your settlement is ready" email without a second lookup.
-- ---------------------------------------------------------------------------

create or replace function run_settlement_cron(
  p_period_start date, p_period_end date, p_secret text
)
returns table (
  partner_id uuid, partner_name text, owner_email text,
  items_settled int, net_payable_paise int, period_start date, period_end date
)
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select
      r.partner_id, p.name, u.email::text,
      r.items_settled, r.net_payable_paise, p_period_start, p_period_end
    from run_settlement_impl(p_period_start, p_period_end) r
    join partners p on p.id = r.partner_id
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = r.partner_id and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id;
end $$;

revoke all on function run_settlement_cron(date, date, text) from public;
grant execute on function run_settlement_cron(date, date, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. mark_settlement_paid gains owner_email/partner_name/net_payable_paise/
--    payout_reference on its result, so lib/admin-settlements.ts can send the
--    "you've been paid" email right after this succeeds. RETURNS TABLE
--    changed shape, so this is a drop + recreate, not a replace.
-- ---------------------------------------------------------------------------

drop function if exists mark_settlement_paid(uuid, text, text);

create function mark_settlement_paid(
  p_batch_id uuid, p_reference text, p_note text default null
) returns table (
  ok boolean, message text, owner_email text, partner_name text,
  net_payable_paise int, payout_reference text
)
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_partner uuid;
  v_net     int;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reference), '') = '' then
    return query select false, 'Add a bank/UPI reference before marking this paid.'::text,
      null::text, null::text, null::int, null::text;
    return;
  end if;

  select status, partner_id, net_payable_paise into v_status, v_partner, v_net
  from settlement_batches where id = p_batch_id for update;

  if v_status is null then
    return query select false, 'That settlement batch no longer exists.'::text,
      null::text, null::text, null::int, null::text;
    return;
  end if;
  if v_status = 'paid' then
    return query select false, 'That batch is already marked paid.'::text,
      null::text, null::text, null::int, null::text;
    return;
  end if;

  update settlement_batches set
    status = 'paid', paid_at = now(), paid_by = auth.uid(),
    payout_reference = trim(p_reference), payout_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_batch_id;

  return query
    select
      true, 'Marked paid.'::text, u.email::text, p.name, v_net, trim(p_reference)
    from partners p
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = v_partner and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    where p.id = v_partner;
end $$;

revoke all on function mark_settlement_paid(uuid, text, text) from public;
grant execute on function mark_settlement_paid(uuid, text, text) to authenticated;

select 'settlement cron + payout emails wired up' as done;
