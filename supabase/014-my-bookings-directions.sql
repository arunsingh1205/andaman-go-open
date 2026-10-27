-- ===========================================================================
-- Migration 014 — "Directions" on the Bookings screen
--
-- A traveller who already booked something wants to find it. Same
-- definer-rights reasoning as 006's partner_name(): my_bookings runs with
-- security_invoker on, so a plain join to `partners` would apply the
-- "approved partners are public" policy to booking history too, and a
-- suspended partner's past bookings would lose their directions. These two
-- functions deliberately see past that filter, and each returns exactly one
-- field and nothing else about the partner.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function partner_maps_url(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select maps_url from partners where id = p_partner_id
$$;

create or replace function partner_address(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select address from partners where id = p_partner_id
$$;

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
  i.state,
  i.ticket_code,
  i.redeemed_at,
  partner_maps_url(i.partner_id)      as maps_url,
  partner_address(i.partner_id)       as address
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);

grant select on my_bookings to authenticated, anon;
grant execute on function partner_maps_url(uuid) to authenticated, anon;
grant execute on function partner_address(uuid) to authenticated, anon;

-- Check: directions still resolve for a booking made with a partner who has
-- since been suspended or rejected.
select ref_code, title, operator, maps_url, address
from my_bookings
order by on_date desc, starts_at;
