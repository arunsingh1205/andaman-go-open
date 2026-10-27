-- ===========================================================================
-- Migration 146 — admin_bookings and partner_bookings lost contact_name
--
-- 088 added bookings.contact_name and included b.contact_name in that
-- migration's own redefinitions of both admin_bookings and partner_bookings,
-- specifically so whoever dispatches or receives a rate-card cab booking
-- knows who they're calling.
--
-- 097 (adding stays) redefined partner_bookings again and dropped
-- contact_name from the column list without comment — almost certainly a
-- rebase off an older copy of the view. 137 (partner commission) redefined
-- admin_bookings again and made the same drop. Neither migration touched
-- contact_name deliberately; it's simply missing from both current
-- definitions. Confirmed by an audit agent grepping every redefinition of
-- both views across the full migration history.
--
-- Net effect: bookings.contact_name is now being correctly written (144
-- fixed the column existing at all) and read back nowhere — the admin
-- console and the assigned operator's dashboard select b.contact_name
-- through these views and always get null, so the "Name" row never renders
-- (app/admin/(dashboard)/bookings/bookings-view.tsx and
-- app/partner/(dashboard)/bookings/[itemId]/booking-detail-view.tsx both
-- guard on `booking.contactName &&`). No crash, no error — a booking made
-- and confirmed with a real name on file, and dispatch just never sees it.
--
-- Fix: reissue both views exactly as 137/097 currently define them, with
-- b.contact_name appended at the END of each select list. CREATE OR REPLACE
-- VIEW can only add new columns after the existing ones — inserting
-- contact_name in the middle (088's original position) shifts every column
-- after it by one ordinal slot, which Postgres reports as renaming each of
-- them (error 42P16: cannot change name of view column "contact_phone" to
-- "contact_name") rather than as adding a column. Both consumers
-- (lib/admin-bookings.ts, lib/partner-bookings.ts) select by field name via
-- supabase-js, not by position, so where the column sits in the list has no
-- effect on either.
--
-- Safe to run more than once.
-- ===========================================================================

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
  b.created_at    as booked_at,
  p.commission_bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.cancelled_at,
  i.delivery_paise,
  i.refund_status,
  i.cab_id,
  i.driver_id,
  i.stay_room_type_id,
  i.units,
  b.contact_name
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


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
  b.contact_email,
  i.cancelled_note,
  i.confirmed_at,
  b.created_at as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'traveller' and m.read_at is null
  ) as unread_from_traveller,
  i.subject_id,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.units,
  b.contact_name
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);
revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;

select 'admin_bookings / partner_bookings: contact_name restored' as done;
