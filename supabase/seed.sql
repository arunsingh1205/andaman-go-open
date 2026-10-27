-- ===========================================================================
-- Andaman Go — seed data
--
-- Generated from the app's own lib/*.ts modules, so what lands in the database
-- is exactly what the screens showed before the swap. If a price here differs
-- from a price on screen, the generator is wrong, not the app.
--
-- Run this AFTER schema.sql. Safe to re-run: it clears the catalogue first.
--
-- Dates are written as offsets from current_date rather than fixed days, so
-- re-running it tomorrow gives you a fresh week rather than a stale one.
-- ===========================================================================

truncate booking_items, bookings, availability,
         activity_schedule, activities, restaurant_tables, restaurants,
         vehicles, sailings, events, trips, partners, islands
  restart identity cascade;
-- `partners` and `islands` cascade to cabs / cab_routes / cab_trip_details /
-- cab_places, so those are cleared too; the cab seed and cab_places seed below
-- rebuild them (migration 048 also seeds cab_places, for a migrate-without-seed
-- workflow).

-- Islands. `name` is what the app shows — the official names since migration
-- 041; lib/islands.ts adds the familiar name in parentheses for the picker.
insert into islands (slug, name, official_name, sort_order) values
  ('port-blair', 'Sri Vijaya Puram', 'Sri Vijaya Puram', 1),
  ('havelock',   'Swaraj Dweep',     'Swaraj Dweep',     2),
  ('neil',       'Shaheed Dweep',    'Shaheed Dweep',    3),
  ('baratang',   'Baratang',         'Baratang',         4);

-- Partners. Every business in the app, in one table — this is what the
-- partner app registers into and the admin console approves.
insert into partners (slug, name, kind, island_slug) values
  ('blue-coral-divers', 'Blue Coral Divers', 'dive', 'havelock'),
  ('andaman-sea-walkers', 'Andaman Sea Walkers', 'dive', 'havelock'),
  ('reef-riders', 'Reef Riders', 'dive', 'havelock'),
  ('wave-runners', 'Wave Runners', 'dive', 'havelock'),
  ('government-ferry', 'Government ferry', 'ferry', 'port-blair'),
  ('makruzz', 'Makruzz', 'ferry', 'port-blair'),
  ('green-ocean-2', 'Green Ocean 2', 'ferry', 'port-blair'),
  ('nautika', 'Nautika', 'ferry', 'port-blair'),
  ('full-moon-cafe', 'Full Moon Cafe', 'restaurant', 'havelock'),
  ('anju-coco-resto', 'Anju Coco Resto', 'restaurant', 'havelock'),
  ('something-different', 'Something Different', 'restaurant', 'havelock'),
  ('cafe-del-mar', 'Cafe Del Mar', 'restaurant', 'havelock'),
  ('golden-spoon', 'Golden Spoon', 'restaurant', 'havelock'),
  ('beach-road-rentals', 'Beach Road Rentals', 'rental', 'havelock'),
  ('island-wheels', 'Island Wheels', 'rental', 'havelock'),
  ('govind-scooters', 'Govind Scooters', 'rental', 'havelock'),
  ('sunset-point', 'Sunset Point', 'venue', 'havelock'),
  ('blue-lagoon-shack', 'Blue Lagoon Shack', 'venue', 'havelock'),
  ('open-sand', 'Open sand', 'venue', 'havelock'),
  ('anchor-bar', 'Anchor Bar', 'venue', 'havelock'),
  ('radhanagar-beach', 'Radhanagar Beach', 'venue', 'havelock'),
  ('castaway-beach-club', 'Castaway Beach Club', 'venue', 'havelock'),
  ('ravi-k', 'Ravi K.', 'host', 'neil'),
  ('meera-s', 'Meera S.', 'host', 'havelock'),
  ('anil-d', 'Anil D.', 'host', 'port-blair'),
  ('fatima-b', 'Fatima B.', 'host', 'baratang'),
  ('island-cabs', 'Island Cabs', 'cab', 'port-blair'),
  ('bay-taxi', 'Bay Taxi', 'cab', 'port-blair'),
  ('green-drive-ev', 'Green Drive EV', 'cab', 'port-blair');

update partners set status = 'approved' where kind = 'cab';

-- Activities.
insert into activities (slug, partner_id, island_slug, category, mark, name, summary, about, price_paise, rating, reviews)
select v.slug, p.id, 'havelock', v.category, v.mark, v.name, v.summary, v.about, v.price_paise, v.rating, v.reviews
from (values
  ('try-dive-nemo-reef', 'blue-coral-divers', 'scuba', 'SC', 'Try-dive scuba at Nemo Reef', '3 hrs · hotel pickup · no swimming', 'No experience and no swimming needed. An instructor is with you the whole time, one to one, and you are underwater for about twenty minutes at eight metres.', 350000, 4.8, 212),
  ('sea-walk-elephant-beach', 'andaman-sea-walkers', 'seawalk', 'SW', 'Sea walk at Elephant Beach', '25 min underwater · boat transfer', 'You walk on the sea bed wearing a helmet that keeps your head dry. Glasses are fine. Boat leaves from the jetty and the walk itself is about twenty-five minutes.', 320000, 4.6, 184),
  ('snorkelling-elephant-beach', 'reef-riders', 'snorkel', 'SN', 'Snorkelling at Elephant Beach', '2 hrs · gear and guide included', 'Shallow reef, calm in the mornings, good for families. Mask, fins and a guide in the water with you are all included.', 140000, 4.7, 96),
  ('jet-ski-banana-boat', 'wave-runners', 'water', 'JS', 'Jet ski + banana boat combo', '45 min · life jacket included', 'Fifteen minutes on the jet ski with an instructor riding pillion, then the banana boat with up to five others. Life jackets are compulsory and included.', 180000, 4.4, 311)
) as v(slug, partner_slug, category, mark, name, summary, about, price_paise, rating, reviews)
join partners p on p.slug = v.partner_slug;

-- The recurring timetable. Four departures a day, every day.
-- The 1:30 PM slot carries a reason rather than an if-statement.
insert into activity_schedule (activity_id, time_mins, capacity, closed_reason)
select a.id, v.time_mins, v.capacity, v.closed_reason from activities a cross join (values
  (390, 8, null),
  (480, 8, null),
  (600, 6, null),
  (810, 6, 'Sea too rough')
) as v(time_mins, capacity, closed_reason);

-- Ferries. "Cheapest" and "Fastest" are gone — they are worked out from
-- the fare and the duration when the list is sorted, not stored here.
-- style_label / style_tone / info are the card badge and the line under the
-- fare (migration 003 first set these; kept here so a re-seed doesn't blank
-- them).
insert into sailings (code, partner_id, from_island, to_island, style_label, style_tone, info, info_warn, dep_mins, duration_mins, fare_paise, capacity)
select v.code, p.id, 'port-blair', 'havelock', v.style_label, v.style_tone, v.info, v.info_warn, v.dep_mins, v.duration_mins, v.fare_paise, v.capacity
from (values
  ('gov', 'government-ferry', 'Standard', 'plain', 'Booked for you on STARS', false, 380, 150, 63000, 200),
  ('makruzz', 'makruzz', 'Deluxe', 'plain', 'Window seats available', false, 480, 90, 165000, 120),
  ('green', 'green-ocean-2', 'Popular', 'warm', '', false, 660, 105, 130000, 120),
  ('nautika', 'nautika', 'Premium', 'plain', 'Sea gets choppy after 2 PM', true, 810, 85, 175000, 100)
) as v(code, partner_slug, style_label, style_tone, info, info_warn, dep_mins, duration_mins, fare_paise, capacity)
join partners p on p.slug = v.partner_slug;

-- Restaurants. price_tier is 1/2/3 here; the ₹ symbols are a display job.
insert into restaurants (slug, partner_id, island_slug, category, mark, name, area, distance_label, price_tier, rating, reviews, blurb, about)
select v.slug, p.id, 'havelock', v.category, v.mark, v.name, v.area, v.distance_label, v.price_tier, v.rating, v.reviews, v.blurb, v.about
from (values
  ('full-moon-cafe', 'full-moon-cafe', 'seafood', 'FM', 'Full Moon Cafe', 'Beach No. 5', '900 m away', 2, 4.6, 312, 'Beachfront seafood and thali, tables right on the sand at sunset.', 'Grilled catch of the day, Andamanese thali, and a bonfire pit that gets going after 8. A reservation holds your table for fifteen minutes past the booked time.'),
  ('anju-coco-resto', 'anju-coco-resto', 'indian', 'AC', 'Anju Coco Resto', 'Govind Nagar', '1.6 km away', 1, 4.5, 178, 'North and South Indian, generous thalis, popular with families.', 'A no-frills local favourite — thalis, dosas and a full North Indian menu. Gets busy after 8, so a table held in advance is worth it.'),
  ('something-different', 'something-different', 'continental', 'SD', 'Something Different', 'Beach No. 5', '3.2 km away', 3, 4.7, 264, 'Wood-fired pizza and continental plates, right on the beach.', 'Candlelit tables in the sand, a wood-fired oven, and a short but excellent wine list. The best sunset table in Havelock.'),
  ('cafe-del-mar', 'cafe-del-mar', 'cafe', 'CD', 'Cafe Del Mar', 'Beach No. 3', '2.4 km away', 2, 4.4, 140, 'All-day cafe menu — good coffee, bigger plates after 7.', 'Starts as a breakfast and coffee spot, switches to a full seafood and pasta menu by evening. Live acoustic sets most Fridays.'),
  ('golden-spoon', 'golden-spoon', 'indian', 'GS', 'Golden Spoon', 'Govind Nagar', '1.1 km away', 1, 4.8, 401, 'The island''s best-rated thali, cash only, worth the queue.', 'Unlimited thali, cooked fresh in small batches — they close the kitchen once the day''s stock runs out, so an evening reservation is the safer bet.')
) as v(slug, partner_slug, category, mark, name, area, distance_label, price_tier, rating, reviews, blurb, about)
join partners p on p.slug = v.partner_slug;

-- Table slots. table_count is TABLES, not seats — the units mix-up that
-- broke the Dine screen is now spelled out in the column name.
insert into restaurant_tables (restaurant_id, time_mins, table_count)
select r.id, v.time_mins, v.table_count from restaurants r cross join (values
  (1110, 6),
  (1140, 8),
  (1170, 6),
  (1200, 8),
  (1230, 6),
  (1260, 4)
) as v(time_mins, table_count);

-- Rental vehicles. seats is what fixes "one bicycle for four people" in
-- Plan my day: four people need ceil(4 / seats) of them.
insert into vehicles (code, partner_id, type, model, rate_paise, seats, meta)
select v.code, p.id, v.type, v.model, v.rate_paise, v.seats, v.meta from (values
  ('activa', 'beach-road-rentals', 'scooter', 'Honda Activa 6G', 50000, 2, '2 helmets · unlimited km'),
  ('jupiter', 'beach-road-rentals', 'scooter', 'TVS Jupiter', 45000, 2, '2 helmets · unlimited km'),
  ('sprint', 'beach-road-rentals', 'bicycle', 'Hero Sprint cycle', 25000, 1, 'Helmet · basket · 7 gears'),
  ('access', 'island-wheels', 'scooter', 'Suzuki Access 125', 45000, 2, '2 helmets · unlimited km'),
  ('himalayan', 'island-wheels', 'bike', 'Royal Enfield Himalayan', 140000, 2, '2 helmets · rider + pillion'),
  ('pulsar', 'island-wheels', 'bike', 'Bajaj Pulsar 150', 90000, 2, '2 helmets · unlimited km'),
  ('ntorq', 'govind-scooters', 'scooter', 'TVS Ntorq 125', 60000, 2, '2 helmets · phone mount'),
  ('dio', 'govind-scooters', 'scooter', 'Honda Dio', 52000, 2, '2 helmets · unlimited km'),
  ('firefox', 'govind-scooters', 'bicycle', 'Firefox mountain bike', 30000, 1, 'Helmet · 21 gears')
) as v(code, partner_slug, type, model, rate_paise, seats, meta)
join partners p on p.slug = v.partner_slug;

-- A rental shop is browsed directly, so its rating and blurb go on the
-- partner row rather than on a separate listing.
update partners p set rating = v.rating, reviews = v.reviews,
       distance_label = v.distance_label, blurb = v.blurb
from (values
  ('beach-road-rentals', 4.8::numeric(2,1), 156, '1.4 km away', 'Family run, open 7 AM to 8 PM. Two helmets with every scooter.'),
  ('island-wheels', 4.6::numeric(2,1), 98, '600 m away', 'The only shop on the island renting geared bikes for the Kalapathar run.'),
  ('govind-scooters', 4.9::numeric(2,1), 211, '2.1 km away', 'Newest fleet on Havelock. Phone mounts on every scooter as standard.')
) as v(partner_slug, rating, reviews, distance_label, blurb)
where p.slug = v.partner_slug;

-- Events are real dated things, so they store a date. Written relative to
-- today so the seed does not go stale the day after you run it.
insert into events (slug, partner_id, island_slug, genre, mark, name, venue, area, on_date, time_mins, entry_paise, capacity, rating, reviews, about, age_restriction, performer)
select v.slug, p.id, 'havelock', v.genre, v.mark, v.name, v.venue, v.area, v.on_date, v.time_mins, v.entry_paise, v.capacity, v.rating, v.reviews, v.about, v.age_restriction, v.performer
from (values
  ('beach-dj-sunset-point', 'sunset-point', 'dj', 'DJ', 'Beach DJ session', 'Sunset Point', 'Beach No. 3', (current_date)::date, 1260, 80000, 120, 4.6, 89, 'Deep house and afrobeat on the sand, bar on-site, gets going properly after 10. Entry includes one welcome drink.', '18+', 'DJ Resin'),
  ('reggae-night-blue-lagoon', 'blue-lagoon-shack', 'live', 'RG', 'Reggae night', 'Blue Lagoon Shack', 'Beach No. 5', (current_date)::date, 1230, 50000, 80, 4.3, 52, 'A live reggae four-piece that''s played the same shack every week for six years. Small, loud, and full by 9.', 'all-ages', 'Roots Collective'),
  ('bonfire-drum-circle', 'open-sand', 'bonfire', 'BF', 'Bonfire drum circle', 'Open sand', 'Beach No. 5', (current_date)::date, 1140, 0, 200, 4.5, 203, 'Free and open — bring your own drum or borrow one. Starts at sunset, runs until the tide comes in.', 'all-ages', null),
  ('karaoke-night-anchor', 'anchor-bar', 'karaoke', 'KO', 'Karaoke night', 'Anchor Bar', 'Govind Nagar', (current_date + 1)::date, 1290, 0, 60, 4.2, 37, 'Free entry, one drink minimum. The mic is open from nine and the crowd is kind to bad singers.', 'all-ages', null),
  ('full-moon-party-radhanagar', 'radhanagar-beach', 'dj', 'FM', 'Full moon party', 'Radhanagar Beach', 'Radhanagar', (current_date + 2)::date, 1200, 100000, 300, 4.7, 156, 'The big one — three DJs, fire performers, and a crowd that comes from every hotel on the island. Entry includes one drink.', '18+', 'DJ Kade, DJ Row & DJ Ilsa'),
  ('live-acoustic-anju', 'anju-coco-resto', 'live', 'LB', 'Live acoustic set', 'Anju Coco Resto', 'Govind Nagar', (current_date + 1)::date, 1200, 0, 50, 4.4, 41, 'A local duo plays acoustic covers over dinner. No entry fee, just a table booking.', 'all-ages', 'The Anju Duo'),
  ('dj-night-castaway', 'castaway-beach-club', 'dj', 'DJ', 'DJ Night', 'Castaway Beach Club', 'Beach No. 7', (current_date + 3)::date, 1260, 60000, 150, 4.5, 0, 'A resident DJ spins house and Bollywood remixes right on the sand, fairy lights strung between the palms. Entry includes one welcome drink.', 'all-ages', 'DJ Nyx')
) as v(slug, partner_slug, genre, mark, name, venue, area, on_date, time_mins, entry_paise, capacity, rating, reviews, about, age_restriction, performer)
join partners p on p.slug = v.partner_slug;

-- Trips. "Runs Tue, Thu, Sat" is a recurrence, so it is stored as one.
insert into trips (slug, partner_id, island_slug, title, host_name, host_since, duration_label, runs_on_days, price_paise, difficulty, min_seats, seats_total, rating, reviews, summary, includes, bring_list, meet_point)
select v.slug, p.id, v.island_slug, v.title, v.host_name, v.host_since, v.duration_label, v.runs_on_days, v.price_paise, v.difficulty, v.min_seats, v.seats_total, v.rating, v.reviews, v.summary, v.includes, v.bring_list, v.meet_point
from (values
  ('neil-in-a-day', 'ravi-k', 'neil', 'Neil Island in a day', 'Ravi K.', 'hosting since 2023', 'Full day · 6 AM to 7 PM', '{2,4,6}'::int[], 250000, 'moderate', 4, 8, 4.9, 38, 'Ferry both ways, the Bharatpur reef before the crowd, Natural Bridge timed to low tide, and lunch at my aunt''s kitchen in Lakshmanpur.', '{"Return ferry from Port Blair","Snorkelling at Bharatpur with gear","Natural Bridge at low tide","Home-cooked lunch, fish or veg","Scooter between beaches"}'::text[], '{"Swimwear","Reef-safe sunscreen","Change of clothes"}'::text[], 'Phoenix Bay jetty, 5:45 AM'),
  ('havelock-sunrise-reef', 'meera-s', 'havelock', 'Havelock sunrise and reef', 'Meera S.', 'hosting since 2022', 'Half day · 5 AM to 12 PM', '{0,1,2,3,4,5,6}'::int[], 320000, 'easy', 3, 6, 4.8, 52, 'Radhanagar at first light with nobody on it, then the Elephant Beach reef while the water is still glass. Breakfast on the sand after.', '{"Pickup from your hotel","Sunrise at Radhanagar","Boat to Elephant Beach","Snorkelling with a guide in the water","Breakfast and tea"}'::text[], '{"Swimwear","Reef shoes or sandals","Sunscreen"}'::text[], 'Your hotel reception, 4:40 AM'),
  ('port-blair-history-walk', 'anil-d', 'port-blair', 'Port Blair history walk', 'Anil D.', 'hosting since 2021', 'Half day · 3 PM to 8 PM', '{0,1,2,3,4,5,6}'::int[], 140000, 'easy', 2, 12, 4.7, 91, 'Cellular Jail with the stories the plaques leave out, the old Aberdeen bazaar, and the light and sound show with seats already held.', '{"Cellular Jail entry and guide","Aberdeen bazaar walk","Light and sound show seats","Chai and snacks"}'::text[], '{"Comfortable walking shoes","Water bottle"}'::text[], 'Cellular Jail gate, 2:50 PM'),
  ('baratang-mangroves', 'fatima-b', 'baratang', 'Baratang mangroves and caves', 'Fatima B.', 'hosting since 2024', 'Full day · 3 AM to 6 PM', '{1,3,5}'::int[], 380000, 'challenging', 6, 10, 4.6, 24, 'The early convoy through the reserve, the mangrove creek by speedboat, and the limestone caves. Long day, but the creek is worth the alarm.', '{"Convoy vehicle and permits","Speedboat through the creek","Limestone cave guide","Breakfast and lunch"}'::text[], '{"Photo ID for the forest permit","Closed-toe shoes for the caves","Torch or phone light"}'::text[], 'Aberdeen jetty, 2:45 AM')
) as v(slug, partner_slug, island_slug, title, host_name, host_since, duration_label, runs_on_days, price_paise, difficulty, min_seats, seats_total, rating, reviews, summary, includes, bring_list, meet_point)
join partners p on p.slug = v.partner_slug;

-- Cabs / car hire (migration 048 owns the schema). cab_places is re-seeded
-- here because the truncate above cascades through islands and clears it.
insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('port-blair', 'Veer Savarkar International Airport', '{airport,veer savarkar,port blair airport,ixz,vsi}', true, 1),
  ('port-blair', 'Aberdeen Bazaar',        '{aberdeen,bazaar,market,city centre,town}', false, 2),
  ('port-blair', 'Phoenix Bay Jetty',      '{phoenix bay,phoenix jetty,ferry terminal}', false, 3),
  ('port-blair', 'Haddo Wharf',            '{haddo,wharf,harbour}', false, 4),
  ('port-blair', 'Marina Park',            '{marina,marina park,rajiv gandhi water sports}', false, 5),
  ('port-blair', 'Corbyn''s Cove Beach',   '{corbyn,corbyns cove,cove beach}', false, 6),
  ('port-blair', 'Cellular Jail',          '{cellular jail,kala pani,national memorial}', false, 7),
  ('port-blair', 'Sippighat',              '{sippighat}', false, 8),
  ('port-blair', 'Garacharma',             '{garacharma}', false, 9),
  ('port-blair', 'Bathu Basti',            '{bathu basti,bathubasti}', false, 10),
  ('port-blair', 'Junglighat',             '{junglighat,jungli ghat}', false, 11),
  ('port-blair', 'Dollygunj',              '{dollygunj,dolly gunj}', false, 12),
  ('port-blair', 'Bambooflat',             '{bambooflat,bamboo flat}', false, 13),
  ('port-blair', 'Ferrargunj',             '{ferrargunj,ferrar gunj}', false, 14),
  ('port-blair', 'Wandoor',                '{wandoor,anet,mahatma gandhi marine park}', false, 15),
  ('port-blair', 'Chidiya Tapu',           '{chidiya tapu,chidiyatapu,sunset point,munda pahar}', false, 16),
  ('port-blair', 'Mount Harriet',          '{mount harriet,manipur,mount manipur}', false, 17),
  ('port-blair', 'Madhuban',               '{madhuban}', false, 18),
  ('port-blair', 'Chouldari',              '{chouldari}', false, 19),
  ('port-blair', 'Jirkatang',              '{jirkatang,jarawa checkpost}', false, 20),
  ('port-blair', 'Baratang Jetty',         '{baratang,nilambur,limestone caves,mud volcano}', false, 21),
  ('port-blair', 'Diglipur',               '{diglipur,north andaman}', false, 22),
  ('port-blair', 'Rangat',                 '{rangat,middle andaman}', false, 23),
  ('port-blair', 'Mayabunder',             '{mayabunder}', false, 24)
on conflict (island_slug, label) do nothing;

insert into cabs (code, partner_id, category, model, seats, luggage, ac, fuel, board_number, full_day_paise, airport_surcharge_paise, night_surcharge_paise, per_km_paise, per_min_paise, meta, is_listed)
select v.code, p.id, v.category, v.model, v.seats, v.luggage, v.ac, v.fuel, v.board_number,
       v.full_day_paise, v.airport_surcharge_paise, v.night_surcharge_paise, v.per_km_paise, v.per_min_paise, v.meta, true
from (values
  ('island-cabs-dzire',  'island-cabs',    'sedan',    'Maruti Dzire',          4, 2, true, 'petrol', 'AN-01-T-2210', 350000, 20000, 30000, 1800, 200, 'AC sedan, experienced local driver'),
  ('island-cabs-innova', 'island-cabs',    'suv',      'Toyota Innova Crysta',  6, 3, true, 'diesel', 'AN-01-T-2211', 550000, 30000, 40000, 2200, 250, 'Best for families and the Baratang run'),
  ('bay-taxi-wagonr',    'bay-taxi',       'hatchback','Maruti WagonR',         4, 1, true, 'petrol', 'AN-01-T-1804', 300000, 15000, 25000, 1500, 150, 'Compact, quick around town'),
  ('bay-taxi-tempo',     'bay-taxi',       'tempo',    'Force Tempo Traveller', 12, 8, true, 'diesel', 'AN-01-T-1805', 900000, 40000, 50000, 3500, 350, 'Group trips, full-flight airport runs'),
  ('green-drive-tigor',  'green-drive-ev', 'sedan',    'Tata Tigor EV',         4, 2, true, 'ev',     'AN-01-T-3090', 400000, 20000, 30000, 1600, 180, 'Silent, zero-emission, city and Chidiya Tapu')
) as v(code, partner_slug, category, model, seats, luggage, ac, fuel, board_number, full_day_paise, airport_surcharge_paise, night_surcharge_paise, per_km_paise, per_min_paise, meta)
join partners p on p.slug = v.partner_slug;

-- A cab operator is browsed directly, so rating / blurb sit on the partner row.
update partners p set rating = v.rating, reviews = v.reviews, distance_label = v.distance_label, blurb = v.blurb
from (values
  ('island-cabs',    4.7::numeric(2,1), 218, 'Port Blair', 'Round-the-clock airport pickups, drivers who know every reef and viewpoint.'),
  ('bay-taxi',       4.5::numeric(2,1), 141, 'Port Blair', 'Fixed fares, WagonR to Tempo Traveller, 15 years on the road.'),
  ('green-drive-ev', 4.8::numeric(2,1),  63, 'Port Blair', 'The islands'' first all-electric fleet — airport, city and sunset runs.')
) as v(partner_slug, rating, reviews, distance_label, blurb)
where p.slug = v.partner_slug;

-- Route fares. from/to resolve against cab_places by label.
insert into cab_routes (cab_id, from_place_id, to_place_id, oneway_paise, roundtrip_paise)
select c.id, fp.id, tp.id, v.oneway_paise, v.roundtrip_paise
from (values
  ('island-cabs-dzire',  'Veer Savarkar International Airport', 'Aberdeen Bazaar',       45000,  80000),
  ('island-cabs-dzire',  'Veer Savarkar International Airport', 'Corbyn''s Cove Beach',   55000,  95000),
  ('island-cabs-dzire',  'Aberdeen Bazaar',                    'Wandoor',               120000, 200000),
  ('island-cabs-dzire',  'Aberdeen Bazaar',                    'Chidiya Tapu',          140000, 240000),
  ('island-cabs-innova', 'Veer Savarkar International Airport', 'Aberdeen Bazaar',        60000, 110000),
  ('island-cabs-innova', 'Aberdeen Bazaar',                    'Chidiya Tapu',          190000, 320000),
  ('island-cabs-innova', 'Aberdeen Bazaar',                    'Baratang Jetty',        650000,1100000),
  ('bay-taxi-wagonr',    'Veer Savarkar International Airport', 'Aberdeen Bazaar',        40000,  70000),
  ('bay-taxi-wagonr',    'Aberdeen Bazaar',                    'Corbyn''s Cove Beach',   35000,  60000),
  ('bay-taxi-wagonr',    'Aberdeen Bazaar',                    'Wandoor',               110000, 190000),
  ('bay-taxi-tempo',     'Veer Savarkar International Airport', 'Aberdeen Bazaar',        90000, 160000),
  ('bay-taxi-tempo',     'Aberdeen Bazaar',                    'Baratang Jetty',        850000,1500000),
  ('green-drive-tigor',  'Veer Savarkar International Airport', 'Aberdeen Bazaar',        48000,  85000),
  ('green-drive-tigor',  'Aberdeen Bazaar',                    'Chidiya Tapu',          150000, 260000),
  ('green-drive-tigor',  'Aberdeen Bazaar',                    'Corbyn''s Cove Beach',   40000,  70000)
) as v(cab_code, from_label, to_label, oneway_paise, roundtrip_paise)
join cabs c on c.code = v.cab_code
join cab_places fp on fp.label = v.from_label
join cab_places tp on tp.label = v.to_label
on conflict (cab_id, from_place_id, to_place_id) do nothing;

-- ---------------------------------------------------------------------------
-- Availability: places already taken. Seats left is capacity minus this.
--
-- These rows stand in for bookings that were made before you had a database.
-- Once real bookings exist a trigger maintains this table and nothing else
-- writes to it.
-- ---------------------------------------------------------------------------
insert into availability (kind, subject_id, starts_at, taken) values
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 1 + time '08:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 1 + time '10:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 2 + time '06:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 2 + time '08:00:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 2 + time '10:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 2 + time '13:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 3 + time '06:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 3 + time '08:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 3 + time '10:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 3 + time '13:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 4 + time '06:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 4 + time '08:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 4 + time '13:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 5 + time '06:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 5 + time '08:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 5 + time '10:00:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 5 + time '13:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 6 + time '06:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 6 + time '10:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'try-dive-nemo-reef'), (current_date + 6 + time '13:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 1 + time '08:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 1 + time '10:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 2 + time '06:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 2 + time '08:00:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 2 + time '10:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 2 + time '13:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 3 + time '06:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 3 + time '08:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 3 + time '10:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 3 + time '13:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 4 + time '06:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 4 + time '08:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 4 + time '13:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 5 + time '06:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 5 + time '08:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 5 + time '10:00:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 5 + time '13:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 6 + time '06:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 6 + time '10:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'sea-walk-elephant-beach'), (current_date + 6 + time '13:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 1 + time '08:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 1 + time '10:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 2 + time '06:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 2 + time '08:00:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 2 + time '10:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 2 + time '13:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 3 + time '06:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 3 + time '08:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 3 + time '10:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 3 + time '13:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 4 + time '06:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 4 + time '08:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 4 + time '13:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 5 + time '06:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 5 + time '08:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 5 + time '10:00:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 5 + time '13:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 6 + time '06:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 6 + time '10:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'snorkelling-elephant-beach'), (current_date + 6 + time '13:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 1 + time '08:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 1 + time '10:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 2 + time '06:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 2 + time '08:00:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 2 + time '10:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 2 + time '13:30:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 3 + time '06:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 3 + time '08:00:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 3 + time '10:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 3 + time '13:30:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 4 + time '06:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 4 + time '08:00:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 4 + time '13:30:00') at time zone 'Asia/Kolkata', 3),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 5 + time '06:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 5 + time '08:00:00') at time zone 'Asia/Kolkata', 6),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 5 + time '10:00:00') at time zone 'Asia/Kolkata', 1),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 5 + time '13:30:00') at time zone 'Asia/Kolkata', 4),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 6 + time '06:30:00') at time zone 'Asia/Kolkata', 5),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 6 + time '10:00:00') at time zone 'Asia/Kolkata', 2),
  ('activity', (select id from activities where slug = 'jet-ski-banana-boat'), (current_date + 6 + time '13:30:00') at time zone 'Asia/Kolkata', 5),
  ('table', (select id from restaurants where slug = 'full-moon-cafe'), (current_date + time '18:30:00') at time zone 'Asia/Kolkata', 2),
  ('table', (select id from restaurants where slug = 'full-moon-cafe'), (current_date + time '19:00:00') at time zone 'Asia/Kolkata', 5),
  ('table', (select id from restaurants where slug = 'full-moon-cafe'), (current_date + time '19:30:00') at time zone 'Asia/Kolkata', 1),
  ('table', (select id from restaurants where slug = 'full-moon-cafe'), (current_date + time '20:00:00') at time zone 'Asia/Kolkata', 2),
  ('table', (select id from restaurants where slug = 'full-moon-cafe'), (current_date + time '21:00:00') at time zone 'Asia/Kolkata', 2),
  ('table', (select id from restaurants where slug = 'anju-coco-resto'), (current_date + time '18:30:00') at time zone 'Asia/Kolkata', 5),
  ('table', (select id from restaurants where slug = 'anju-coco-resto'), (current_date + time '19:00:00') at time zone 'Asia/Kolkata', 8),
  ('table', (select id from restaurants where slug = 'anju-coco-resto'), (current_date + time '19:30:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'anju-coco-resto'), (current_date + time '20:00:00') at time zone 'Asia/Kolkata', 5),
  ('table', (select id from restaurants where slug = 'anju-coco-resto'), (current_date + time '20:30:00') at time zone 'Asia/Kolkata', 3),
  ('table', (select id from restaurants where slug = 'something-different'), (current_date + time '18:30:00') at time zone 'Asia/Kolkata', 1),
  ('table', (select id from restaurants where slug = 'something-different'), (current_date + time '19:00:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'something-different'), (current_date + time '20:00:00') at time zone 'Asia/Kolkata', 1),
  ('table', (select id from restaurants where slug = 'something-different'), (current_date + time '20:30:00') at time zone 'Asia/Kolkata', 6),
  ('table', (select id from restaurants where slug = 'something-different'), (current_date + time '21:00:00') at time zone 'Asia/Kolkata', 1),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '18:30:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '19:00:00') at time zone 'Asia/Kolkata', 7),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '19:30:00') at time zone 'Asia/Kolkata', 3),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '20:00:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '20:30:00') at time zone 'Asia/Kolkata', 2),
  ('table', (select id from restaurants where slug = 'cafe-del-mar'), (current_date + time '21:00:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'golden-spoon'), (current_date + time '18:30:00') at time zone 'Asia/Kolkata', 6),
  ('table', (select id from restaurants where slug = 'golden-spoon'), (current_date + time '19:30:00') at time zone 'Asia/Kolkata', 5),
  ('table', (select id from restaurants where slug = 'golden-spoon'), (current_date + time '20:00:00') at time zone 'Asia/Kolkata', 6),
  ('table', (select id from restaurants where slug = 'golden-spoon'), (current_date + time '20:30:00') at time zone 'Asia/Kolkata', 4),
  ('table', (select id from restaurants where slug = 'golden-spoon'), (current_date + time '21:00:00') at time zone 'Asia/Kolkata', 1),
  ('event', (select id from events where slug = 'beach-dj-sunset-point'), (current_date + time '21:00:00') at time zone 'Asia/Kolkata', 74),
  ('event', (select id from events where slug = 'reggae-night-blue-lagoon'), (current_date + time '20:30:00') at time zone 'Asia/Kolkata', 61),
  ('event', (select id from events where slug = 'bonfire-drum-circle'), (current_date + time '19:00:00') at time zone 'Asia/Kolkata', 118),
  ('event', (select id from events where slug = 'karaoke-night-anchor'), (current_date + 1 + time '21:30:00') at time zone 'Asia/Kolkata', 22),
  ('event', (select id from events where slug = 'full-moon-party-radhanagar'), (current_date + 2 + time '20:00:00') at time zone 'Asia/Kolkata', 240),
  ('event', (select id from events where slug = 'live-acoustic-anju'), (current_date + 1 + time '20:00:00') at time zone 'Asia/Kolkata', 18),
  ('ferry', (select id from sailings where code = 'green'), (current_date + 1 + time '11:00:00') at time zone 'Asia/Kolkata', 111),
  ('trip', (select id from trips where slug = 'neil-in-a-day'), (current_date + 2 + time '06:00:00') at time zone 'Asia/Kolkata', 4),
  ('trip', (select id from trips where slug = 'havelock-sunrise-reef'), (current_date + 1 + time '06:00:00') at time zone 'Asia/Kolkata', 5),
  ('trip', (select id from trips where slug = 'port-blair-history-walk'), (current_date + 1 + time '06:00:00') at time zone 'Asia/Kolkata', 7),
  ('trip', (select id from trips where slug = 'baratang-mangroves'), (current_date + 1 + time '06:00:00') at time zone 'Asia/Kolkata', 2);

-- Done. A quick look at what landed:
select
  (select count(*) from islands)     as islands,
  (select count(*) from partners)    as partners,
  (select count(*) from activities)  as activities,
  (select count(*) from sailings)    as sailings,
  (select count(*) from restaurants) as restaurants,
  (select count(*) from vehicles)    as vehicles,
  (select count(*) from events)      as events,
  (select count(*) from trips)       as trips,
  (select count(*) from cabs)        as cabs,
  (select count(*) from cab_places)  as cab_places,
  (select count(*) from cab_routes)  as cab_routes,
  (select count(*) from availability) as availability_rows;
