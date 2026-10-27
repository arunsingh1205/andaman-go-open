-- ===========================================================================
-- Migration 107 — settlement WhatsApp, riding alongside the existing
-- settlement emails (105).
--
-- run_settlement_cron and mark_settlement_paid both gain a whatsapp_number
-- column on their result, read off partners.whatsapp_number (106), so
-- app/api/cron/settlement/route.ts and lib/admin-settlements.ts can send a
-- WhatsApp right next to the email they already send, with no extra lookup.
-- Both RETURNS TABLE shapes changed, so both are drop + recreate, same as
-- 105 already did to mark_settlement_paid for the same reason.
--
-- A partner with no whatsapp_number on file (the common case until 106's
-- column gets backfilled) simply gets whatsapp_number = null back — the Node
-- side already knows to skip a WhatsApp send when that's null.
--
-- Safe to run more than once.
-- ===========================================================================


drop function if exists run_settlement_cron(date, date, text);

create function run_settlement_cron(
  p_period_start date, p_period_end date, p_secret text
)
returns table (
  partner_id uuid, partner_name text, owner_email text, whatsapp_number text,
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
      r.partner_id, p.name, u.email::text, p.whatsapp_number,
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


drop function if exists mark_settlement_paid(uuid, text, text);

create function mark_settlement_paid(
  p_batch_id uuid, p_reference text, p_note text default null
) returns table (
  ok boolean, message text, owner_email text, whatsapp_number text, partner_name text,
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
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;

  select status, partner_id, net_payable_paise into v_status, v_partner, v_net
  from settlement_batches where id = p_batch_id for update;

  if v_status is null then
    return query select false, 'That settlement batch no longer exists.'::text,
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;
  if v_status = 'paid' then
    return query select false, 'That batch is already marked paid.'::text,
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;

  update settlement_batches set
    status = 'paid', paid_at = now(), paid_by = auth.uid(),
    payout_reference = trim(p_reference), payout_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_batch_id;

  return query
    select
      true, 'Marked paid.'::text, u.email::text, p.whatsapp_number, p.name, v_net, trim(p_reference)
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

select 'settlement whatsapp wired up' as done;
