-- ===========================================================================
-- Migration 114 — admin RPC to set partners.whatsapp_number.
--
-- The column has existed since 106-notification-log.sql (it's what
-- notify_booking_comms and the settlement cron read to decide whether a
-- partner gets a WhatsApp message), but nothing has ever been able to write
-- it — there's no partner-facing UI for it yet, so for now an admin sets it
-- by hand while onboarding WhatsApp. Mirrors admin_set_partner_contact_phone
-- (075) exactly, including the same India-assumption cleaning.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function admin_set_partner_whatsapp_number(p_partner_id uuid, p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_clean text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set whatsapp_number = nullif(v_clean, '') where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_whatsapp_number(uuid, text) from public;
grant execute on function admin_set_partner_whatsapp_number(uuid, text) to authenticated;

select 'admin can set partner whatsapp number' as done;
