-- ===========================================================================
-- Migration 019 — the partner finds out WHY a booking was cancelled
--
-- 018 gave an admin admin_cancel_booking(), and made the reason mandatory and
-- stored (booking_items.cancelled_note). But nothing on the partner side can
-- read it: partner_bookings (009) predates the column, so a partner opens
-- their Bookings tab, finds something they had confirmed now sitting as
-- "Refunded", and has no way to learn who did that or why.
--
-- This is the other half of that feature. One column onto one view.
--
-- NOTE the column position. CREATE OR REPLACE VIEW can only APPEND columns —
-- Postgres refuses to add one in the middle, which is exactly the mistake
-- migration 014 made and had to undo. So cancelled_note goes on the END of
-- the select list, after contact_email, not next to `state` where it would
-- read more naturally.
--
-- No new RLS is needed: booking_items already carries "partner sees own
-- items" (009), and this is one more column on rows the partner could
-- already see.
--
-- Safe to run more than once.
-- ===========================================================================

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
  i.cancelled_note
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

-- CREATE OR REPLACE VIEW keeps existing options, but re-assert it rather than
-- rely on that: without security_invoker this view stops respecting RLS.
alter view partner_bookings set (security_invoker = on);

revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;
