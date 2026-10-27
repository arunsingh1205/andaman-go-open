-- ===========================================================================
-- Migration 051 — undoing a mistaken check-in
--
-- redeem_booking (005) has no way back: once tapped, state -> 'completed'
-- and there is no un-redeem anywhere in the app. The Bookings tab
-- (partner-bookings-list.tsx) puts a one-tap "Check in" button on every
-- confirmed booking with no confirmation step and no gate on how far in the
-- future starts_at is — so a stray tap while scrolling can mark tomorrow's
-- or Sunday's booking "Checked in" today, and there was nothing a partner
-- could do about it except contact support.
--
-- undo_redeem_booking_item is the way back. Scoped tight on purpose:
--
--   * only the partner who owns the item can undo it (same check every
--     other partner RPC here makes).
--   * only the SAME CALENDAR DAY (IST) the check-in happened — a check-in
--     from yesterday or earlier already fed today's Earnings numbers, and
--     letting that move retroactively is how a partner and Andaman Go end
--     up looking at two different totals for a month that's already closed
--     out in someone's head. Same-day covers the actual failure mode this
--     exists for: "I tapped the wrong card, they never showed."
--
-- Reverts exactly what redeem_booking set: state back to 'confirmed',
-- redeemed_at and redeemed_by cleared. sync_availability() (004) reopens
-- the slot off the state change, same as every other state transition here.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function undo_redeem_booking_item(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_state    text;
  v_redeemed timestamptz;
  v_owner    uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, redeemed_at, partner_id into v_state, v_redeemed, v_owner
  from booking_items where id = p_item_id
  for update;

  if v_owner is null or v_owner <> v_partner then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_state <> 'completed' or v_redeemed is null then
    return query select false, 'This booking hasn''t been checked in.'::text;
    return;
  end if;

  if (v_redeemed at time zone 'Asia/Kolkata')::date <> (now() at time zone 'Asia/Kolkata')::date then
    return query select false, 'Check-ins can only be undone the same day.'::text;
    return;
  end if;

  update booking_items
  set state = 'confirmed', redeemed_at = null, redeemed_by = null
  where id = p_item_id;

  return query select true, 'Check-in undone.'::text;
end $$;

revoke all on function undo_redeem_booking_item(uuid) from public;
grant execute on function undo_redeem_booking_item(uuid) to authenticated;
