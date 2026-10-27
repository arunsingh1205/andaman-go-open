-- ===========================================================================
-- Migration 010 — a partner accepts or declines a pending booking
--
-- create_booking() marks activity/trip/rental bookings 'pending' because the
-- operator has to say yes first — a boat only has so many seats, and only the
-- dive shop knows whether today's booking is one to take. Until now nothing
-- let them actually say that: the bookings list (009) could show a pending
-- booking but not act on it. This is the missing verb.
--
-- confirm_booking() does exactly what create_booking() does when it makes a
-- booking 'confirmed' from the start — it stamps a ticket code in the same
-- format (ref code + kind initial) — because a confirmed booking should look
-- identical however it got there.
--
-- decline_booking() reuses the 'refunded' state rather than inventing a new
-- one. Two reasons: the trigger that reopens the seat already treats
-- 'refunded' as "give it back" (sync_availability(), 004-writes.sql), so
-- nothing new has to know about a decline to free up the slot; and no real
-- money has moved yet (deposits aren't built — see the project roadmap), so
-- there is no actual refund to distinguish from a cancellation. If real
-- payments land later, a decline should probably trigger a real refund and
-- may deserve its own state at that point — for now, one cancellation path
-- beats two that mean the same thing to every screen that reads `state`.
--
-- Both are scoped to the caller's own partner_users link, the same way
-- redeem_booking() and look_up_booking() are (005-redemption.sql) — a dive
-- shop cannot confirm or decline someone else's booking, even by guessing an
-- id, because the WHERE clause never matches a row it doesn't own.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function confirm_booking(p_item_id uuid)
returns table (ok boolean, message text, ticket_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_kind    text;
  v_state   text;
  v_ref     text;
  v_ticket  text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.kind, i.state, b.ref_code into v_kind, v_state, v_ref
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_ref is null then
    return query select false, 'Booking not found.'::text, null::text;
    return;
  end if;

  if v_state <> 'pending' then
    return query select false, 'This booking is not waiting on you anymore.'::text, null::text;
    return;
  end if;

  v_ticket := v_ref || '-' || upper(left(v_kind, 1));

  update booking_items
  set state = 'confirmed', ticket_code = v_ticket
  where id = p_item_id;

  return query select true, 'Confirmed.'::text, v_ticket;
end $$;

create or replace function decline_booking(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_state   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.state into v_state
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  -- Pending: the ordinary "can't take this one" case. Confirmed: the
  -- operator needs to back out of something they already accepted (the boat
  -- broke down, say) — same effect, same free-the-slot behaviour, so it
  -- shares the function rather than needing a second one.
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  update booking_items set state = 'refunded' where id = p_item_id;

  return query select true, 'Declined.'::text;
end $$;

revoke all on function confirm_booking(uuid) from public;
revoke all on function decline_booking(uuid) from public;
grant execute on function confirm_booking(uuid) to authenticated;
grant execute on function decline_booking(uuid) to authenticated;
