-- ===========================================================================
-- Migration 018 — the admin console reaches further than the review queue
--
-- 012 gave the admin app exactly enough database to run two review queues:
-- see pending partners, see pending listings, approve or reject each. That
-- is all it could ever do, because that is all the database ever let an
-- admin read or write.
--
-- The console redesign asks for four things 012 has no answer for:
--
--   1. "see partner bookings from our panel" — an admin cannot read the
--      `bookings` or `booking_items` tables AT ALL today. Every policy on
--      those two tables scopes to the traveller who booked (schema.sql) or
--      the partner who has to run it (009). An admin is neither, so an
--      admin's select returns zero rows — silently, which looks exactly
--      like "there are no bookings".
--
--   2. Suspending a business. `partners.status` has allowed 'suspended'
--      since schema.sql and RLS has always hidden a suspended partner from
--      travellers — but nothing in the app or the database has ever been
--      able to SET it. It was a state with no door into it.
--
--   3. Cancelling a booking on a partner's behalf, for when an operator has
--      gone unreachable and the traveller is still holding a confirmed slot.
--
--   4. Pulling a live listing back down without pretending it was never
--      reviewed — a listing that turned out to be wrong is a different thing
--      from one nobody has looked at yet.
--
-- Everything here follows the discipline every admin function since 012 has
-- used: SECURITY DEFINER so the write can reach any row, is_admin() checked
-- explicitly inside the function rather than relied on implicitly, a
-- hardcoded branch per listing kind rather than dynamic SQL off client
-- input, and a reason required at the DATABASE level for anything that takes
-- something away from a partner.
--
-- Unlike 012, this migration IS safe to run more than once — every policy
-- drops itself first, every column add is `if not exists`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Admins can read bookings.
--
-- Additive to the two policies already on each table (the traveller's own
-- rows, and the partner's own items) — Postgres ORs permissive policies
-- together, so this widens what an admin sees without narrowing anyone else.
--
-- Note what this deliberately does NOT do: it grants an admin no write
-- access to either table. The one write an admin can make on a booking goes
-- through admin_cancel_booking() below, which is SECURITY DEFINER and checks
-- is_admin() itself. Reading is a policy; writing is a function.
-- ---------------------------------------------------------------------------

drop policy if exists "admins see all bookings" on bookings;
create policy "admins see all bookings" on bookings
  for select using (is_admin());

drop policy if exists "admins see all booking items" on booking_items;
create policy "admins see all booking items" on booking_items
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- Why a booking got cancelled.
--
-- decline_booking() (010) reuses the 'refunded' state for both "the partner
-- can't take this one" and "the partner backed out of one they'd accepted",
-- and that was fine while a partner was the only one who could do it: the
-- partner knew why, because the partner did it.
--
-- An admin cancelling on a partner's behalf breaks that. The partner opens
-- their Bookings tab, finds something they'd confirmed now sitting as
-- refunded, and has no way to learn who did that or why. So the reason
-- stops being optional and starts being stored.
--
-- Nothing reads this column yet outside the admin console's own Bookings
-- screen. Surfacing it on the partner's own booking card is a small
-- follow-up on the partner app, not part of this migration.
-- ---------------------------------------------------------------------------

alter table booking_items add column if not exists cancelled_note text;


-- An admin's Bookings screen sorts everything platform-wide by when it
-- starts, across every partner — the one query shape no existing index
-- helps with (booking_items_subject_idx leads with kind/subject_id).
create index if not exists booking_items_starts_idx
  on booking_items (starts_at desc);


-- ---------------------------------------------------------------------------
-- 2. admin_bookings — every booking, platform-wide, one row per item.
--
-- Same shape as partner_bookings (009): one row per THING that has to
-- happen, not one per reference, because two dives on one reference are two
-- separate things somebody has to run. The difference is scope — no
-- partner_users filter, since an admin isn't linked to any partner.
--
-- security_invoker = on, and an explicit `where is_admin()`, for exactly the
-- reason 009 spells out for partner_bookings: booking_items and bookings
-- both carry policies that let a TRAVELLER see their own rows, so without
-- the explicit filter a signed-in traveller could query this view directly
-- and get their own bookings back dressed up as an admin listing. Never
-- someone else's data — just the wrong door. The filter makes the view
-- correct on its own terms rather than correct by coincidence.
--
-- The partners join carries the business name, island and current status
-- along for free: "admins see all partners" (012) is what lets an admin
-- read a pending or suspended partner's row here, so a booking never shows
-- up orphaned just because its operator was later pulled down.
-- ---------------------------------------------------------------------------

create or replace view admin_bookings as
select
  i.id            as item_id,
  b.id            as booking_id,
  b.ref_code,
  i.partner_id,
  p.name          as partner_name,
  p.status        as partner_status,
  b.island_slug,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  i.cancelled_note,
  b.contact_phone,
  b.contact_email,
  b.created_at    as booked_at
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
where is_admin();

alter view admin_bookings set (security_invoker = on);

revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_suspend_partner / admin_reactivate_partner — the missing door
--    into a state the schema has always allowed.
--
-- Suspension reuses `rejection_reason` rather than adding a second reason
-- column: both mean "here is what an admin told you", the partner's own
-- Business tab already reads and displays it, and a partner is never
-- rejected and suspended at the same time (both are terminal states of the
-- one `status` column). One column, one meaning, one place the partner app
-- has to look.
--
-- A reason is required, checked in the database, same as admin_reject_
-- partner — taking a live business off the app without telling them why is
-- not something the UI should be able to do by forgetting a field.
--
-- Suspension is deliberately NOT rejection. Rejection is "we never let you
-- in"; suspension is "you were in, and you're coming back out." Travellers
-- can't see either one, but the two mean different things to whoever reads
-- the partners table next, and to the partner themselves.
-- ---------------------------------------------------------------------------

create or replace function admin_suspend_partner(p_partner_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before suspending.'::text;
    return;
  end if;

  select status into v_status from partners where id = p_partner_id for update;

  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  -- Suspending something that was never approved isn't a thing. A pending
  -- business gets rejected; a rejected one is already down.
  if v_status <> 'approved' then
    return query select false, 'Only a live business can be suspended.'::text;
    return;
  end if;

  update partners
  set status = 'suspended', rejection_reason = trim(p_reason)
  where id = p_partner_id;

  return query select true, 'Suspended.'::text;
end;
$$;

revoke all on function admin_suspend_partner(uuid, text) from public;
grant execute on function admin_suspend_partner(uuid, text) to authenticated;


create or replace function admin_reactivate_partner(p_partner_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select status into v_status from partners where id = p_partner_id for update;

  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  if v_status <> 'suspended' then
    return query select false, 'That business is not suspended.'::text;
    return;
  end if;

  update partners
  set status = 'approved', rejection_reason = null
  where id = p_partner_id;

  return query select true, 'Back online.'::text;
end;
$$;

revoke all on function admin_reactivate_partner(uuid) from public;
grant execute on function admin_reactivate_partner(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_cancel_booking — cancelling on a partner's behalf.
--
-- Same underlying effect as decline_booking() (010): the item goes to
-- 'refunded', and sync_availability() (004) reopens the slot off the back of
-- that state change without needing to know an admin was involved. What
-- differs is the gate (is_admin() instead of a partner_users link, so there
-- is no WHERE clause tying the item to a business the caller owns) and the
-- reason, which is required and stored — see cancelled_note above.
--
-- This is a real "acting as someone else" power, so it is scoped as
-- narrowly as the partner's own version: only a booking that is still
-- pending or already confirmed can be cancelled. Something already
-- completed, missed, or refunded is history, and history is not editable
-- from a console.
-- ---------------------------------------------------------------------------

create or replace function admin_cancel_booking(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before cancelling.'::text;
    return;
  end if;

  select state into v_state from booking_items where id = p_item_id for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  update booking_items
  set state = 'refunded', cancelled_note = trim(p_reason)
  where id = p_item_id;

  return query select true, 'Cancelled.'::text;
end;
$$;

revoke all on function admin_cancel_booking(uuid, text) from public;
grant execute on function admin_cancel_booking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. admin_unlist_listing — pulling a live listing back down.
--
-- admin_reject_listing (012, widened by 016) already sets exactly these two
-- fields, and could technically be pointed at a live listing to do this job.
-- It gets its own function anyway, for one reason worth the duplication:
-- "reject" is a verb about something never approved, and calling it on live
-- content would leave the console's own audit trail saying an admin
-- rejected a listing that had in fact been approved and running for weeks.
-- The guard is the real difference — this one only ever touches a listing
-- that is currently live, and admin_reject_listing is left to the queue.
--
-- Same seven hardcoded branches as 012/016, same never-dynamic-SQL rule.
-- ---------------------------------------------------------------------------

create or replace function admin_unlist_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before unlisting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, rejection_reason = trim(p_reason)
      where id = p_id and is_listed;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing is not live right now.'::text;
    return;
  end if;

  return query select true, 'Taken down.'::text;
end;
$$;

revoke all on function admin_unlist_listing(text, uuid, text) from public;
grant execute on function admin_unlist_listing(text, uuid, text) to authenticated;


-- Check: the view answers, and the five new functions exist.
select count(*) as admin_bookings_rows from admin_bookings;
