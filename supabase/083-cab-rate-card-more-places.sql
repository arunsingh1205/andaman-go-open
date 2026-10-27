-- ===========================================================================
-- Migration 083 — more destinations on the rate card
--
-- The "Book a ride" destination search only ever shows a place that has a
-- fare on cab_rate_card (rate-card-search.tsx builds its list from the rate
-- card, not the raw place list) — so a well-known spot with no fare row
-- simply doesn't turn up, even if it's already sitting in cab_places.
-- Several of Port Blair's standard sightseeing stops were exactly that:
-- Cellular Jail, Mount Harriet and Madhuban were seeded as places back in
-- 048 but never got a rate. This adds those, plus new places + fares for
-- the rest of the usual Port Blair circuit and Havelock's Elephant Beach.
--
-- Fares here are estimates — the tier of nearby stops already on the card,
-- cross-checked against the competitor rate cards researched earlier
-- (andamanocean.in, andamancabsbooking.com, cabsinandaman.com) — not a
-- confirmed union figure for each one. Review and correct them at
-- /admin/cab-rates; nothing here is final.
--
-- Safe to run more than once.
-- ===========================================================================

insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('port-blair', 'Samudrika Naval Marine Museum', '{samudrika,naval museum,marine museum}', false, 37),
  ('port-blair', 'Anthropological Museum',        '{anthropological museum,anthropology museum}', false, 38),
  ('port-blair', 'Fisheries Museum',               '{fisheries museum,aquarium}', false, 39),
  ('port-blair', 'Chatham Saw Mill',               '{chatham,saw mill,chatham island}', false, 40),
  ('port-blair', 'Zoological Park',                '{zoo,zoological park,mini zoo}', false, 41),
  ('havelock',   'Elephant Beach',                 '{elephant beach,elephant trek}', false, 5)
on conflict (island_slug, label) do nothing;

insert into cab_rate_card (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order)
select v.island_slug, v.label, v.trip_type, null,
       (select id from cab_places where island_slug = v.island_slug and label = v.to_label),
       'suv', v.fare_paise, 0, v.sort_order
from (values
  -- Already-seeded Port Blair places (048) that never got a fare.
  ('port-blair', 'Cellular Jail',                 'roundtrip', 'Cellular Jail',                 35000,  21),
  ('port-blair', 'Mount Harriet',                  'roundtrip', 'Mount Harriet',                 280000, 22),
  ('port-blair', 'Madhuban',                       'roundtrip', 'Madhuban',                      220000, 23),
  ('port-blair', 'Marina Park (Ross / North Bay boat jetty)', 'roundtrip', 'Marina Park',         35000,  24),
  -- New Port Blair museum-circuit stops.
  ('port-blair', 'Samudrika Naval Marine Museum',  'roundtrip', 'Samudrika Naval Marine Museum', 40000,  25),
  ('port-blair', 'Anthropological Museum',         'roundtrip', 'Anthropological Museum',        40000,  26),
  ('port-blair', 'Fisheries Museum',                'roundtrip', 'Fisheries Museum',              35000,  27),
  ('port-blair', 'Chatham Saw Mill',                'roundtrip', 'Chatham Saw Mill',              40000,  28),
  ('port-blair', 'Zoological Park',                 'roundtrip', 'Zoological Park',               40000,  29),
  -- Havelock.
  ('havelock',   'Elephant Beach',                  'roundtrip', 'Elephant Beach',                50000,  5)
) as v(island_slug, label, trip_type, to_label, fare_paise, sort_order)
where not exists (
  select 1 from cab_rate_card existing
  where existing.island_slug = v.island_slug and existing.label = v.label
);


select 'more cab rate card destinations ready' as done,
  (select count(*) from cab_rate_card) as rates,
  (select count(*) from cab_places) as places;
