-- ===========================================================================
-- Migration 046 — the operator's phone reaches the traveller who booked
--
-- After a booking, the traveller often needs the operator directly — where's
-- the pickup, can we come 30 minutes late, is the sea alright. Same
-- definer-rights reasoning as 014's partner_maps_url / partner_address:
-- my_bookings runs security_invoker, so a plain join to `partners` would drop
-- a suspended operator's number from their past bookings. This function sees
-- past that filter and returns exactly one field.
--
-- Only ever reaches someone through my_bookings, which only ever holds the
-- caller's own rows — so an operator's number is shown to a traveller who has
-- booked with them (free or paid), and never on the public catalogue.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function partner_phone(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select contact_phone from partners where id = p_partner_id
$$;

revoke all on function partner_phone(uuid) from public;
grant execute on function partner_phone(uuid) to authenticated, anon;


-- Append operator_phone to my_bookings. create-or-replace is fine — the column
-- list is 034's, unchanged, with one new column at the end.
create or replace view my_bookings as
select
  i.id                                as item_id,
  b.id                                as booking_id,
  b.ref_code,
  b.on_date,
  b.island_slug,
  isl.name                            as island_name,
  i.kind,
  i.subject_id,
  subject_title(i.kind, i.subject_id) as title,
  partner_name(i.partner_id)          as operator,
  i.starts_at,
  i.party,
  i.price_paise,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  partner_maps_url(i.partner_id)      as maps_url,
  partner_address(i.partner_id)       as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating,
  partner_phone(i.partner_id)         as operator_phone
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


-- Check: the column resolves.
select ref_code, operator, operator_phone from my_bookings order by booked_at desc limit 5;
