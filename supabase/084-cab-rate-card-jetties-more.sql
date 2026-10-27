-- ===========================================================================
-- Migration 084 — jetties, the airport, and more beaches on the rate card
--
-- Same gap as 083: Phoenix Bay Jetty and Haddo Wharf have been sitting in
-- cab_places since 048 with no fare, so "Book a ride" never surfaced them —
-- and neither did the airport itself, arguably the single most common cab
-- need on the island. This rounds those out, adds the two jetty/boat points
-- research turned up that weren't places yet (Chatham Jetty, and the
-- Aberdeen Jetty Ross Island/North Bay departs from — distinct from Phoenix
-- Bay and Haddo), and a few more named Havelock beaches.
--
-- A transfer (airport, a jetty) is 'oneway' — you're either catching
-- something or just arrived, not touring and coming back — matching how
-- the Havelock/Neil jetty transfers were already modelled (080). A beach or
-- sightseeing stop stays 'roundtrip', matching 083.
--
-- Fares are estimates again, not a confirmed union figure — same caveat as
-- 083, correct them at /admin/cab-rates.
--
-- Safe to run more than once.
-- ===========================================================================

insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('port-blair', 'Chatham Jetty',                      '{chatham jetty,chatham}', false, 42),
  ('port-blair', 'Aberdeen Jetty (Ross Island / North Bay)',
     '{aberdeen jetty,ross island,north bay,netaji subhas chandra bose dweep,rajiv gandhi water sports}', false, 43),
  ('havelock',   'Govind Nagar Beach',                 '{govind nagar,beach no 3,beach 3,nemo reef}', false, 6),
  ('havelock',   'Vijaynagar Beach',                   '{vijaynagar,vijay nagar,beach no 5,beach 5}', false, 7),
  ('havelock',   'Beach No. 1',                        '{beach no 1,beach 1,first beach}', false, 8)
on conflict (island_slug, label) do nothing;

-- A couple of existing places read better with one more search term.
update cab_places set aliases = aliases || '{swaraj dweep jetty}'
  where island_slug = 'havelock' and label = 'Havelock Jetty' and not ('swaraj dweep jetty' = any(aliases));
update cab_places set aliases = aliases || '{shaheed dweep jetty}'
  where island_slug = 'neil' and label = 'Neil Jetty' and not ('shaheed dweep jetty' = any(aliases));
update cab_places set aliases = aliases || '{natural bridge,laxmanpur 2}'
  where island_slug = 'neil' and label = 'Laxmanpur Beach' and not ('natural bridge' = any(aliases));

insert into cab_rate_card (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order)
select v.island_slug, v.label, v.trip_type, null,
       (select id from cab_places where island_slug = v.island_slug and label = v.to_label),
       'suv', v.fare_paise, 0, v.sort_order
from (values
  -- Already-seeded Port Blair places (048) that never got a fare.
  ('port-blair', 'Airport transfer',                       'oneway', 'Veer Savarkar International Airport', 35000, 30),
  ('port-blair', 'Aberdeen Bazaar',                         'oneway', 'Aberdeen Bazaar',                     30000, 31),
  ('port-blair', 'Phoenix Bay Jetty transfer',              'oneway', 'Phoenix Bay Jetty',                   30000, 32),
  ('port-blair', 'Haddo Wharf transfer',                    'oneway', 'Haddo Wharf',                         30000, 33),
  -- New Port Blair jetty/boat points.
  ('port-blair', 'Chatham Jetty transfer',                  'oneway', 'Chatham Jetty',                       35000, 34),
  ('port-blair', 'Aberdeen Jetty (Ross Island / North Bay)', 'oneway', 'Aberdeen Jetty (Ross Island / North Bay)', 35000, 35),
  -- Havelock.
  ('havelock',   'Govind Nagar Beach',                      'roundtrip', 'Govind Nagar Beach',                50000, 6),
  ('havelock',   'Vijaynagar Beach',                        'roundtrip', 'Vijaynagar Beach',                  50000, 7),
  ('havelock',   'Beach No. 1',                              'roundtrip', 'Beach No. 1',                       45000, 8)
) as v(island_slug, label, trip_type, to_label, fare_paise, sort_order)
where not exists (
  select 1 from cab_rate_card existing
  where existing.island_slug = v.island_slug and existing.label = v.label
);


select 'jetty and more beach rate card entries ready' as done,
  (select count(*) from cab_rate_card) as rates,
  (select count(*) from cab_places) as places;
