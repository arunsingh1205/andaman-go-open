-- ===========================================================================
-- Migration 112 — the booking notification's "party" field was the raw
-- integer (new.party, e.g. "2"), not a formatted label. The in-app partner
-- feed trigger (notify_partner_of_booking, 020) already computes a proper
-- label ("Table for 2" / "2 adults" / "2 seats" / "2 guests" depending on
-- kind) — notify_booking_comms (106) gets the same formatting here so the
-- newly-branded booking email (supabase/functions/send-notification) reads
-- naturally instead of showing a bare number.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function notify_booking_comms() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title            text;
  v_when             text;
  v_party            text;
  v_owner_email      text;
  v_partner_whatsapp text;
  v_customer_id      uuid;
  v_customer_email   text;
  v_customer_phone   text;
  v_customer_name    text;
begin
  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
  v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');

  -- Same wording as notify_partner_of_booking() (020) — kept in sync by hand.
  v_party := case
    when new.kind = 'table' then 'Table for ' || new.party
    when new.kind = 'ferry' then new.party || case when new.party = 1 then ' adult' else ' adults' end
    when new.kind = 'trip'  then new.party || case when new.party = 1 then ' seat' else ' seats' end
    else new.party || case when new.party = 1 then ' guest' else ' guests' end
  end;

  select u.email::text, p.whatsapp_number
    into v_owner_email, v_partner_whatsapp
  from partners p
  left join lateral (
    select pu.user_id
    from partner_users pu
    where pu.partner_id = new.partner_id and pu.role = 'owner'
    order by pu.created_at asc
    limit 1
  ) owner on true
  left join auth.users u on u.id = owner.user_id
  where p.id = new.partner_id;

  select b.user_id, b.contact_email, b.contact_phone, b.contact_name
    into v_customer_id, v_customer_email, v_customer_phone, v_customer_name
  from bookings b where b.id = new.booking_id;

  if v_owner_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'email', 'partner', v_owner_email, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'party', v_party, 'kind', new.kind),
      new.partner_id, new.id
    );
  end if;

  if v_partner_whatsapp is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'whatsapp', 'partner', v_partner_whatsapp, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'party', v_party, 'kind', new.kind),
      new.partner_id, new.id
    );
  end if;

  if v_customer_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'email', 'customer', v_customer_email, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'name', v_customer_name),
      v_customer_id, new.id
    );
  end if;

  if v_customer_phone is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'whatsapp', 'customer', v_customer_phone, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'name', v_customer_name),
      v_customer_id, new.id
    );
  end if;

  return null;
end $$;

select 'booking comms party label fixed' as done;
