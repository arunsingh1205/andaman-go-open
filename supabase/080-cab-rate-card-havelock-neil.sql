-- ===========================================================================
-- Migration 080 — the rate card, extended to Havelock and Neil
--
-- 077 seeded Port Blair only. Havelock and Neil are small enough that a
-- traveller's cab needs are really just two things: the jetty transfer
-- (their hotel to the jetty, or back — the fare is the same either way, so
-- one row prices both directions) and a couple of named beaches. No new
-- schema, no new columns — this is purely more rows in cab_places and
-- cab_rate_card, on the same 'suv' tier as Port Blair.
--
-- Havelock is where the app already defaults a first-time visitor (see
-- DEFAULT_ISLAND_ID in lib/islands.ts) — before this, that traveller landed
-- on "Book a ride" with an empty rate card.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Named places on each island.
-- ---------------------------------------------------------------------------

insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('havelock', 'Havelock Jetty',   '{havelock jetty,jetty,ferry terminal,harbour}', false, 1),
  ('havelock', 'Radhanagar Beach', '{radhanagar,radha nagar,beach no 7,beach 7}', false, 2),
  ('havelock', 'Kalapathar Beach', '{kalapathar,kala pathar,beach no 5,beach 5}', false, 3),
  ('neil',     'Neil Jetty',       '{neil jetty,jetty,ferry terminal,harbour}', false, 1),
  ('neil',     'Laxmanpur Beach',  '{laxmanpur,lakshmanpur,sunset point}', false, 2),
  ('neil',     'Bharatpur Beach',  '{bharatpur,bharat pur}', false, 3),
  ('neil',     'Sitapur Beach',    '{sitapur,sita pur,sunrise point}', false, 4)
on conflict (island_slug, label) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Fares — from_place_id null (standard hotel pickup, either island's
--    equivalent of Port Blair's city zone), one vehicle tier ('suv').
-- ---------------------------------------------------------------------------

insert into cab_rate_card (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order)
select v.island_slug, v.label, v.trip_type, null,
       (select id from cab_places where island_slug = v.island_slug and label = v.to_label),
       'suv', v.fare_paise, 0, v.sort_order
from (values
  ('havelock', 'Point to point (within the island)', 'oneway',    null,               30000,  1),
  ('havelock', 'Havelock Jetty transfer',             'oneway',   'Havelock Jetty',   45000,  2),
  ('havelock', 'Radhanagar Beach',                    'roundtrip','Radhanagar Beach', 120000, 3),
  ('havelock', 'Kalapathar Beach',                    'roundtrip','Kalapathar Beach', 120000, 4),
  ('neil',     'Point to point (within the island)',  'oneway',    null,              30000,  1),
  ('neil',     'Neil Jetty transfer',                 'oneway',   'Neil Jetty',       45000,  2),
  ('neil',     'Laxmanpur Beach',                     'roundtrip','Laxmanpur Beach',  40000,  3),
  ('neil',     'Bharatpur Beach',                     'roundtrip','Bharatpur Beach',  40000,  4),
  ('neil',     'Sitapur Beach',                       'roundtrip','Sitapur Beach',    50000,  5)
) as v(island_slug, label, trip_type, to_label, fare_paise, sort_order)
where not exists (
  select 1 from cab_rate_card existing
  where existing.island_slug = v.island_slug and existing.label = v.label
);


select 'havelock and neil rate cards ready' as done,
  (select count(*) from cab_rate_card where island_slug in ('havelock','neil')) as rates,
  (select count(*) from cab_places where island_slug in ('havelock','neil')) as places;
