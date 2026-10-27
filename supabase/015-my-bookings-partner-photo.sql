-- ===========================================================================
-- Migration 015 — the operator's cover photo on the Bookings screen
--
-- Same reasoning as 014's directions functions: a plain join to `partners`
-- would apply the "approved partners are public" policy inside a view that
-- is supposed to survive that filter for a traveller's own history. One more
-- definer-rights function, exposing exactly one field.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function partner_photo_path(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select cover_photo_path from partners where id = p_partner_id
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
  partner_address(i.partner_id)       as address,
  partner_photo_path(i.partner_id)    as photo_path
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);

grant select on my_bookings to authenticated, anon;
grant execute on function partner_photo_path(uuid) to authenticated, anon;

-- Check: a booking's card can show the operator's cover photo, if they set one.
select ref_code, title, operator, photo_path
from my_bookings
order by on_date desc, starts_at;
