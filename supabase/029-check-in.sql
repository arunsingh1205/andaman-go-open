-- ===========================================================================
-- Migration 029 — check-in, past the code box
--
-- redeem_booking (005) is still the one way a booking becomes "delivered".
-- This migration adds the two things a person on the door actually needs
-- alongside it:
--
--   mark_no_show / clear_no_show — a confirmed booking whose time has passed
--     and nobody turned up. The `missed` state has existed in the enum since
--     schema.sql; nothing ever set it. Now the Insights no-show rate has a
--     source, and a stale "confirmed" booking stops sitting on the books.
--
--   adjust_booking_party — three were booked, two came. Lower the count
--     before checking them in, so what's recorded as delivered is what
--     actually happened. Reduce only — more people is a new booking.
--
-- All three are for whoever is working the door, owner or staff, so they're
-- linked-gated, not owner-only (they are NOT wrapped by 027).
--
-- Safe to run more than once.
-- ===========================================================================


create or replace function mark_no_show(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_state    text;
  v_starts   timestamptz;
  v_redeemed timestamptz;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, starts_at, redeemed_at into v_state, v_starts, v_redeemed
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_redeemed is not null then
    return query select false, 'They were already checked in.'::text;
    return;
  end if;
  if v_state <> 'confirmed' then
    return query select false, 'Only a confirmed booking can be marked a no-show.'::text;
    return;
  end if;
  if v_starts > now() then
    return query select false, 'This booking hasn''t started yet.'::text;
    return;
  end if;

  -- sync_availability (004) doesn't count 'missed', so this frees the slot —
  -- which for a slot already in the past is a no-op that matters to nobody.
  update booking_items set state = 'missed' where id = p_item_id;

  return query select true, 'Marked as a no-show.'::text;
end $$;

revoke all on function mark_no_show(uuid) from public;
grant execute on function mark_no_show(uuid) to authenticated;


create or replace function clear_no_show(p_item_id uuid)
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

  select state into v_state
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state <> 'missed' then
    return query select false, 'That booking isn''t marked a no-show.'::text;
    return;
  end if;

  update booking_items set state = 'confirmed' where id = p_item_id;

  return query select true, 'No-show undone.'::text;
end $$;

revoke all on function clear_no_show(uuid) from public;
grant execute on function clear_no_show(uuid) to authenticated;


create or replace function adjust_booking_party(p_item_id uuid, p_party int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_state    text;
  v_party    int;
  v_redeemed timestamptz;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, party, redeemed_at into v_state, v_party, v_redeemed
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_redeemed is not null then
    return query select false, 'Already checked in — the party can''t be changed now.'::text;
    return;
  end if;
  if v_state <> 'confirmed' then
    return query select false, 'Only a confirmed booking can be adjusted.'::text;
    return;
  end if;
  if p_party is null or p_party < 1 or p_party > v_party then
    return query select false,
      format('Enter a number between 1 and %s.', v_party)::text;
    return;
  end if;

  update booking_items set party = p_party where id = p_item_id;

  return query select true, format('Party set to %s.', p_party)::text;
end $$;

revoke all on function adjust_booking_party(uuid, int) from public;
grant execute on function adjust_booking_party(uuid, int) to authenticated;


-- Check: the three functions exist.
select proname from pg_proc
where proname in ('mark_no_show', 'clear_no_show', 'adjust_booking_party')
order by proname;
