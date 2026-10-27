-- ===========================================================================
-- Migration 079 — admin_bookings learns cab_id / driver_id
--
-- The admin console needs to tell a marketplace cab booking (a specific car
-- already chosen at booking time, 048) apart from a rate-card booking (no
-- car yet — cab_id is null, 077/078) so the "Cab · needs driver" queue and
-- the dispatch panel know which rows to act on. Body carried over from 067,
-- the only change is the two added columns.
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
  cr.bps          as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.cancelled_at,
  i.delivery_paise,
  i.refund_status,
  i.cab_id,
  i.driver_id
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;

select 'admin bookings cab dispatch columns ready' as done;
