-- ===========================================================================
-- Migration 087 — the Sedan tier, from the official price list
--
-- Every earlier rate-card migration (077-084) seeded one vehicle tier —
-- 'suv' — priced from the originally pasted card ("Ertiga/Rumion/Xylo") or
-- estimated. This is the first real second tier: a full official "Sedan
-- (AC)" price list, added as vehicle_category = 'sedan' throughout. Nothing
-- existing changes price — a traveller now picks a vehicle class and sees
-- that class's own fare (078's lookup already keyed on vehicle_category;
-- rate-card-search.tsx picks up the new tier once it gets a category
-- selector).
--
-- The source list's own wording sets trip_type: "(Pickup or Drop)" and
-- plain "Taxi Fare" both mean a single-leg transfer ('oneway'); "Round
-- Trip" is explicit. A few multi-day and far excursions (Chidiya Tapu,
-- Wandoor) had no explicit marker but only make sense there-and-back, so
-- they're seeded as 'roundtrip' to match the equivalent SUV entries already
-- on the card — worth a second look at /admin/cab-rates.
--
-- Left out on purpose: generic line items with no fixed place behind them
-- ("Shopping", "Dinner", a couple of duplicate "Sound and Light show" /
-- point-pair rows already covered by their two endpoints separately) and
-- "Extra Luggage Vehicle" (a second support vehicle, not a destination —
-- doesn't fit a one-cab-per-booking rate card).
--
-- Also fixes: the existing SUV "Cellular Jail" row was seeded 'roundtrip'
-- in 083 on a guess; this list confirms it's a plain 'oneway' pickup/drop,
-- like every other in-town stop.
--
-- Safe to run more than once.
-- ===========================================================================

-- "Silver Sand Sea Princess Resort" on the source list is this same place.
update cab_places set aliases = aliases || '{silver sand}'
  where island_slug = 'port-blair' and label = 'Sea Princess Resort' and not ('silver sand' = any(aliases));

update cab_rate_card set trip_type = 'oneway'
  where island_slug = 'port-blair' and label = 'Cellular Jail' and vehicle_category = 'suv' and trip_type = 'roundtrip';

insert into cab_rate_card (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order)
select v.island_slug, v.label, v.trip_type, null,
       (select id from cab_places where island_slug = v.island_slug and label = v.to_label),
       'sedan', v.fare_paise, coalesce(v.nights, 0), v.sort_order
from (values
  -- Port Blair
  ('port-blair', 'Airport transfer',                     'oneway',    'Veer Savarkar International Airport', 30000,  1, null::int),
  ('port-blair', 'Haddo Jetty transfer',                  'oneway',    'Haddo Jetty',                         30000,  2, null),
  ('port-blair', 'Symphony Samudra',                      'oneway',    'Symphony Samudra',                    120000, 3, null),
  ('port-blair', 'Adhvasaha',                              'oneway',    'Adhvasaha',                           120000, 4, null),
  ('port-blair', 'Hotel Idhaya',                           'oneway',    'Idhaya',                              120000, 5, null),
  ('port-blair', 'Rainforest Cottages',                    'oneway',    'Rainforest Cottages',                 120000, 6, null),
  ('port-blair', 'Sea Princess Resort',                    'oneway',    'Sea Princess Resort',                 120000, 7, null),
  ('port-blair', 'Peerless Resort',                        'oneway',    'Peerless Resort',                     80000,  8, null),
  ('port-blair', 'Clarks Exotica Island House',            'oneway',    'Clarks Exotica Island House',         80000,  9, null),
  ('port-blair', 'Sinclairs Bayview',                      'oneway',    'Sinclairs Bayview',                   30000,  10, null),
  ('port-blair', 'ITC Hotel Bay Island',                   'oneway',    'ITC Hotel Bay Island',                30000,  11, null),
  ('port-blair', 'Cellular Jail',                          'oneway',    'Cellular Jail',                       30000,  12, null),
  ('port-blair', 'Corbyn''s Cove Beach',                   'roundtrip', 'Corbyn''s Cove Beach',                80000,  13, null),
  ('port-blair', 'Marina Park transfer',                   'oneway',    'Marina Park',                         30000,  14, null),
  ('port-blair', 'Anthropological Museum',                 'oneway',    'Anthropological Museum',              30000,  15, null),
  ('port-blair', 'Samudrika Naval Marine Museum',          'oneway',    'Samudrika Naval Marine Museum',       30000,  16, null),
  ('port-blair', 'Flag Point',                             'oneway',    'Flag Point',                          30000,  17, null),
  ('port-blair', 'Joggers Park',                           'oneway',    'Joggers Park',                        30000,  18, null),
  ('port-blair', 'Chatham Saw Mill',                       'oneway',    'Chatham Saw Mill',                    30000,  19, null),
  ('port-blair', 'Fisheries Museum',                       'oneway',    'Fisheries Museum',                    30000,  20, null),
  ('port-blair', 'Chidiya Tapu',                           'roundtrip', 'Chidiya Tapu',                        120000, 21, null),
  ('port-blair', 'Wandoor Beach',                          'roundtrip', 'Wandoor',                             120000, 22, null),
  ('port-blair', 'Jolly Buoy Island (via Wandoor Jetty)',  'roundtrip', 'Jolly Buoy',                          250000, 23, null),
  ('port-blair', 'Mount Harriet',                          'roundtrip', 'Mount Harriet',                       350000, 24, null),
  ('port-blair', 'Baratang',                               'roundtrip', 'Baratang Jetty',                      450000, 25, null),
  -- Havelock
  ('havelock',   'Havelock Jetty transfer',                'oneway',    'Havelock Jetty',                      45000,  9,  null),
  ('havelock',   'Taj Exotica Resort',                      'oneway',    'Taj Exotica Resort',                  120000, 10, null),
  ('havelock',   'TSG Blue Resort',                         'oneway',    'TSG Blue Resort',                     120000, 11, null),
  ('havelock',   'Barefoot at Havelock',                    'oneway',    'Barefoot at Havelock',                120000, 12, null),
  ('havelock',   'Silver Sand Beach Resort',                'oneway',    'Silver Sand Beach Resort',            60000,  13, null),
  ('havelock',   'Sandyy Wavess Beach Resort',              'oneway',    'Sandyy Wavess Beach Resort',          60000,  14, null),
  ('havelock',   'Silver Sand Village Resort',              'oneway',    'Silver Sand Village Resort',          200000, 15, null),
  ('havelock',   'Hotel Jalakara',                          'oneway',    'Hotel Jalakara',                      60000,  16, null),
  ('havelock',   'Hotel De Fort',                           'oneway',    'Hotel De Fort',                       80000,  17, null),
  ('havelock',   'Hotel Sea Hills',                         'oneway',    'Hotel Sea Hills',                     80000,  18, null),
  ('havelock',   'Dolphin Beach Resort',                    'oneway',    'Dolphin Beach Resort',                40000,  19, null),
  ('havelock',   'Radhanagar Beach',                        'roundtrip', 'Radhanagar Beach',                    150000, 20, null),
  ('havelock',   'Kalapathar Beach',                        'roundtrip', 'Kalapathar Beach',                    120000, 21, null),
  -- Neil
  ('neil',       'Neil Jetty transfer',                     'oneway',    'Neil Jetty',                          45000,  9,  null),
  ('neil',       'TSG Aura Resort',                         'oneway',    'TSG Aura Resort',                     80000,  10, null),
  ('neil',       'Summer Sand Beach Resort',                'oneway',    'Summer Sand Beach Resort',            60000,  11, null),
  ('neil',       'Aquays Resort',                            'oneway',    'Aquays Resort',                       60000,  12, null),
  ('neil',       'Laxmanpur Beach',                          'oneway',    'Laxmanpur Beach',                     35000,  13, null),
  ('neil',       'Bharatpur Beach',                          'oneway',    'Bharatpur Beach',                     45000,  14, null),
  ('neil',       'Natural Bridge (Howdah Bridge)',           'oneway',    'Natural Bridge (Howdah Bridge)',      45000,  15, null),
  ('neil',       'Sitapur Beach',                            'roundtrip', 'Sitapur Beach',                       80000,  16, null),
  -- North & Middle Andaman (outstation packages)
  ('port-blair', 'Rangat (1N/2D)',                          'outstation','Rangat',                              1050000, 26, 1),
  ('port-blair', 'Mayabunder (2N/3D)',                      'outstation','Mayabunder',                          1450000, 27, 2),
  ('port-blair', 'Diglipur (2N/3D)',                        'outstation','Diglipur',                            1700000, 28, 2)
) as v(island_slug, label, trip_type, to_label, fare_paise, sort_order, nights)
where not exists (
  select 1 from cab_rate_card existing
  where existing.island_slug = v.island_slug and existing.label = v.label and existing.vehicle_category = 'sedan'
);


select 'sedan tier ready' as done,
  (select count(*) from cab_rate_card where vehicle_category = 'sedan') as sedan_rates,
  (select count(*) from cab_rate_card) as all_rates;
