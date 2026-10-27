-- ===========================================================================
-- Migration 009 — a partner's bookings list
--
-- The whole point of the partner app: a partner opens it and sees every
-- upcoming booking headed their way, the way a restaurant sees incoming
-- orders on Zomato. No 15-minute timer, no auto-reassignment — the traveller
-- picked this operator on purpose, so the operator just needs visibility.
--
-- While building this, found a real gap in 005: `partner_delivered` had no
-- partner-scoping at all. It's a plain view (not security_invoker), granted
-- SELECT to `authenticated`, with no WHERE clause tying it to the caller's
-- own partner_id — so any signed-in user, traveller or partner, could
-- `select * from partner_delivered` and see every partner's redeemed
-- bookings platform-wide. It never showed up in testing because testing
-- only ever exercised redeem_booking()/look_up_booking(), which do scope
-- correctly (SECURITY DEFINER, explicit partner_id check inside). Fixed
-- here alongside the new view, using the same pattern.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Give partners real row-level access to their own bookings.
--
-- Until now the only way a partner reached booking data was through
-- SECURITY DEFINER functions (redeem_booking, look_up_booking) that check
-- partner_users internally. A bookings LIST, queried directly by the app the
-- way my_bookings is, needs real RLS underneath it instead.
-- ---------------------------------------------------------------------------

drop policy if exists "partner sees own items" on booking_items;
create policy "partner sees own items" on booking_items
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = booking_items.partner_id
        and pu.user_id = auth.uid()
    )
  );

-- A partner also needs the parent booking row — ref code, contact info — for
-- any booking that includes at least one of their own items. This does not
-- expose a traveller's OTHER items on the same reference (say, a ferry booked
-- alongside a dive): those still belong to a different partner_id, and stay
-- invisible under the policy above.
--
-- This can't be a plain EXISTS subquery against booking_items: that table's
-- own "own booking items" policy queries bookings right back, and Postgres
-- has no way to evaluate a policy that depends on itself — "infinite
-- recursion detected in policy for relation". Same fix as subject_title() /
-- partner_name() elsewhere in this schema: a small SECURITY DEFINER function
-- reads booking_items with the policy system bypassed, so nothing loops.
create or replace function is_partner_for_booking(p_booking_id uuid)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from booking_items bi
    join partner_users pu on pu.partner_id = bi.partner_id
    where bi.booking_id = p_booking_id
      and pu.user_id = auth.uid()
  );
$$;

revoke all on function is_partner_for_booking(uuid) from public;
grant execute on function is_partner_for_booking(uuid) to authenticated;

drop policy if exists "partner sees related bookings" on bookings;
create policy "partner sees related bookings" on bookings
  for select using (is_partner_for_booking(bookings.id));


-- ---------------------------------------------------------------------------
-- partner_bookings — everything headed to the signed-in partner.
--
-- security_invoker = on, same as my_bookings: the view itself grants nothing,
-- it just shapes what the two policies above already allow through.
-- ---------------------------------------------------------------------------

-- security_invoker makes this respect RLS as the caller — but booking_items
-- and bookings both also carry policies that let a TRAVELLER see their own
-- row (that's my_bookings' whole foundation, and it must stay that way). Left
-- alone, a traveller could query partner_bookings directly and see their own
-- booking come back dressed up as a "partner" row — never someone else's
-- data, just the wrong door. The explicit `where` below makes the view
-- correct on its own terms: rows only come back when the caller is actually
-- linked to that item's partner, regardless of what other policies happen to
-- also be sitting on these two tables.
create or replace view partner_bookings as
select
  i.id as item_id,
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  b.contact_phone,
  b.contact_email
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);

revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;


-- Fix the gap properly: security_invoker so it respects RLS, plus the same
-- explicit partner_users filter as partner_bookings above, for the same
-- reason — so it's correct on its own terms, not just because no other
-- policy happens to overlap today.
create or replace view partner_delivered as
select
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.party,
  i.price_paise,
  i.starts_at,
  i.redeemed_at
from booking_items i
join bookings b on b.id = i.booking_id
where i.redeemed_at is not null
  and exists (
    select 1 from partner_users pu
    where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
  );

alter view partner_delivered set (security_invoker = on);


-- Check: a partner's own items should come back; nothing outside partner_users
-- should ever be reachable through either view now.
select count(*) as partner_bookings_rows from partner_bookings;
