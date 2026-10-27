-- ===========================================================================
-- Migration 116 — fix a hard crash on every new booking.
--
-- notify_booking_comms() (106, revised in 112/113) has selected
-- `b.contact_name` from `bookings` since it was first written — but
-- `bookings` has never had a contact_name column (only contact_phone and
-- contact_email, see 034-direct-booking-payments.sql). Since this trigger
-- has no exception handling, that SELECT throws immediately on every single
-- INSERT into booking_items, which means every booking (create_booking,
-- create_cab_booking, create_stay_booking — anything that lands a
-- booking_items row) has been failing outright since 106 shipped.
--
-- The fix here is deliberately minimal: stop referencing a column that
-- doesn't exist, so bookings work again. The customer notification payload's
-- "name" field is now always null (a template can fall back to "there" or
-- omit the greeting) rather than guessing at a source for a real name —
-- adding an actual contact_name column, and wiring something to populate it,
-- is a real feature decision for whoever owns the comms work, not a
-- side-effect of an emergency fix.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function notify_booking_comms() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title            text;
  v_when             text;
  v_party            text;
  v_ref_code         text;
  v_owner_email      text;
  v_partner_whatsapp text;
  v_customer_id      uuid;
  v_customer_email   text;
  v_customer_phone   text;
begin
  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
  v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');

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

  select b.user_id, b.contact_email, b.contact_phone, b.ref_code
    into v_customer_id, v_customer_email, v_customer_phone, v_ref_code
  from bookings b where b.id = new.booking_id;

  if v_owner_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'email', 'partner', v_owner_email, 'booking_new',
      jsonb_build_object(
        'title', v_title, 'when', v_when, 'party', v_party, 'kind', new.kind,
        'ticket_code', new.ticket_code, 'ref_code', v_ref_code
      ),
      new.partner_id, new.id
    );
  end if;

  if v_partner_whatsapp is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'whatsapp', 'partner', v_partner_whatsapp, 'booking_new',
      jsonb_build_object(
        'title', v_title, 'when', v_when, 'party', v_party, 'kind', new.kind,
        'ticket_code', new.ticket_code, 'ref_code', v_ref_code
      ),
      new.partner_id, new.id
    );
  end if;

  if v_customer_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'email', 'customer', v_customer_email, 'booking_new',
      jsonb_build_object(
        'title', v_title, 'when', v_when, 'name', null,
        'ticket_code', new.ticket_code, 'ref_code', v_ref_code
      ),
      v_customer_id, new.id
    );
  end if;

  if v_customer_phone is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'whatsapp', 'customer', v_customer_phone, 'booking_new',
      jsonb_build_object(
        'title', v_title, 'when', v_when, 'name', null,
        'ticket_code', new.ticket_code, 'ref_code', v_ref_code
      ),
      v_customer_id, new.id
    );
  end if;

  return null;
end $$;

-- Check: the function compiles and the table it depends on answers.
select count(*) as booking_items_rows from booking_items;
