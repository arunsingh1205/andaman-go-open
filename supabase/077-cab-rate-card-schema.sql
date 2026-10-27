-- ===========================================================================
-- Migration 077 — Cab rate card + manual driver dispatch, schema
--
-- The self-service cab marketplace (048/049/073) stays exactly as it is: a
-- cab partner lists its own cars and sets its own route fares, and a
-- traveller books a specific car. This migration adds a second, parallel way
-- to book a cab that a union/rate-card operation needs instead:
--
--   * cab_rate_card — one standardized fare per named destination, set by
--     Andaman Go, not by any partner. A traveller books against this table,
--     not against a car.
--   * cab_drivers   — an in-house roster Andaman Go dispatches by hand. Not a
--     partner login — admin adds/edits these directly.
--   * booking_items.driver_id — which driver ended up on a rate-card
--     booking. cab_id (048) stays null for these: a rate-card booking has no
--     specific car chosen at booking time, only after dispatch.
--
-- A rate-card booking is paid and confirmed immediately (same commission
-- split as 073), but sits with ticket_code = null and state = 'pending'
-- until an admin assigns a driver — exactly the shape an unplaced ferry
-- booking already has (039). The booking RPC and the assign RPC live in
-- migration 078.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. cab_places grows the hotels/resorts the rate card names that aren't
--    already seeded (048 already has Dollygunj, Bathu Basti, Garacharma,
--    Corbyn's Cove, Wandoor, Chidiya Tapu, Baratang Jetty, Rangat,
--    Mayabunder, Diglipur).
-- ---------------------------------------------------------------------------

insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('port-blair', 'The Eden',            '{the eden,eden,eden resort,eden zone}', false, 25),
  ('port-blair', 'Manju',               '{manju,manju resort}', false, 26),
  ('port-blair', 'White Coral',         '{white coral,whitecoral}', false, 27),
  ('port-blair', 'Idhaya',              '{idhaya}', false, 28),
  ('port-blair', 'Adhvasaha',           '{adhvasaha,adhvasa}', false, 29),
  ('port-blair', 'Symphony Samudra',    '{symphony,symphony samudra}', false, 30),
  ('port-blair', 'Sea Princess Resort', '{sea princess,sea princess resort}', false, 31),
  ('port-blair', 'Jolly Buoy',          '{jolly buoy,jollybuoy}', false, 32),
  ('port-blair', 'Red Skin Island',     '{red skin,redskin}', false, 33),
  ('port-blair', 'Peerless Resort',     '{peerless,peerless resort}', false, 34),
  ('port-blair', 'Ripple Resort',       '{ripple,ripple resort}', false, 35),
  ('port-blair', 'Kadamtala',           '{kadamtala}', false, 36)
on conflict (island_slug, label) do nothing;


-- ---------------------------------------------------------------------------
-- 2. cab_drivers — the roster Andaman Go dispatches by hand. Not a partner
--    login: admin adds/edits these directly, the way a union roster is run
--    by phone, not by the driver signing in anywhere.
-- ---------------------------------------------------------------------------

create table if not exists cab_drivers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text not null,
  vehicle_category text not null check (vehicle_category in ('hatchback','sedan','suv','tempo')),
  vehicle_model    text not null default '',
  vehicle_number   text not null default '',
  island_slug      text not null references islands(slug),
  is_active        boolean not null default true,
  notes            text not null default '',
  created_at       timestamptz not null default now()
);

create index if not exists cab_drivers_island_idx on cab_drivers (island_slug, is_active);

-- booking_items.driver_id has to exist before the RLS policy below can
-- reference it — added here, not in its own later section, so the file
-- reads top-to-bottom in the order Postgres actually needs it. cab_id (048)
-- stays null for a rate-card booking; "kind = 'cab' and cab_id is null" is
-- how one is told apart from a marketplace booking, so no extra flag column
-- is needed.
alter table booking_items add column if not exists driver_id uuid references cab_drivers(id);

alter table cab_drivers enable row level security;

drop policy if exists "admins see all drivers" on cab_drivers;
create policy "admins see all drivers" on cab_drivers for select using (is_admin());

-- A traveller can see a driver row only once that driver is assigned to one
-- of their own bookings — the same "follows the booking" shape as
-- cab_trip_details (048). Nothing broader: a driver's phone is PII, not
-- catalogue data, so there is no anon/authenticated table grant.
drop policy if exists "traveller sees their assigned driver" on cab_drivers;
create policy "traveller sees their assigned driver" on cab_drivers
  for select using (
    exists (
      select 1 from booking_items bi
      join bookings b on b.id = bi.booking_id
      where bi.driver_id = cab_drivers.id and b.user_id = auth.uid()
    )
  );

grant select on cab_drivers to authenticated;


-- ---------------------------------------------------------------------------
-- 3. cab_rate_card — the standardized fare per named destination.
--
--    from_place_id null  = any pickup in the standard/city zone.
--    to_place_id   null  = only the pure local "point to point" hop (no
--                          fixed destination at all).
--    trip_type 'outstation' is a multi-day package away from the city;
--    `nights` counts the nights it includes (0 for a same-day round trip).
-- ---------------------------------------------------------------------------

create table if not exists cab_rate_card (
  id               uuid primary key default gen_random_uuid(),
  island_slug      text not null references islands(slug),
  label            text not null,
  trip_type        text not null check (trip_type in ('oneway','roundtrip','outstation')),
  from_place_id    uuid references cab_places(id),
  to_place_id      uuid references cab_places(id),
  vehicle_category text not null default 'suv' check (vehicle_category in ('hatchback','sedan','suv','tempo')),
  fare_paise       int not null check (fare_paise > 0),
  nights           int not null default 0 check (nights >= 0),
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists cab_rate_card_lookup_idx
  on cab_rate_card (island_slug, to_place_id, trip_type, vehicle_category)
  where is_active;

alter table cab_rate_card enable row level security;

-- Fares aren't secret — a traveller needs to read this before paying, same
-- trade as cab_places/cab_routes/commission_rates (073).
drop policy if exists "cab rate card is public" on cab_rate_card;
create policy "cab rate card is public" on cab_rate_card for select using (is_active);

drop policy if exists "admins see all cab rates" on cab_rate_card;
create policy "admins see all cab rates" on cab_rate_card for select using (is_admin());

grant select on cab_rate_card to anon, authenticated;


-- Seed: the pasted union rate card (Port Blair, one vehicle tier —
-- "Ertiga/Rumion/Xylo etc." — seeded as 'suv'; a Sedan/Tempo tier can be
-- added later without a schema change). A "/" on the source card (two hotels
-- at the same fare) becomes two rows here, one per named place.
insert into cab_rate_card (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order)
select 'port-blair', v.label, v.trip_type,
       (select id from cab_places where island_slug = 'port-blair' and label = v.from_label),
       (select id from cab_places where island_slug = 'port-blair' and label = v.to_label),
       'suv', v.fare_paise, v.nights, v.sort_order
from (values
  ('Point to point (within city)',        'oneway',     null,             null,                   30000,  0, 1),
  ('Dollygunj Hotel',                     'roundtrip',  null,             'Dollygunj',            35000,  0, 2),
  ('Bathu Basti Hotel',                   'roundtrip',  null,             'Bathu Basti',          40000,  0, 3),
  ('Garacharma Hotel',                    'roundtrip',  null,             'Garacharma',           45000,  0, 4),
  ('The Eden Drop / Zone connect',        'roundtrip',  null,             'The Eden',             60000,  0, 5),
  ('Manju',                               'roundtrip',  null,             'Manju',                70000,  0, 6),
  ('White Coral',                         'roundtrip',  null,             'White Coral',          70000,  0, 6),
  ('Idhaya',                              'roundtrip',  null,             'Idhaya',               90000,  0, 7),
  ('Adhvasaha',                           'roundtrip',  null,             'Adhvasaha',            90000,  0, 7),
  ('Symphony Samudra',                    'roundtrip',  null,             'Symphony Samudra',     120000, 0, 8),
  ('Sea Princess Resort',                 'roundtrip',  null,             'Sea Princess Resort',  120000, 0, 9),
  ('Chidiya Tapu',                        'roundtrip',  null,             'Chidiya Tapu',         140000, 0, 10),
  ('Wandoor',                             'roundtrip',  null,             'Wandoor',              140000, 0, 10),
  ('Jolly Buoy',                          'roundtrip',  null,             'Jolly Buoy',           250000, 0, 11),
  ('Red Skin Island',                     'roundtrip',  null,             'Red Skin Island',      250000, 0, 11),
  ('Peerless Resort',                     'roundtrip',  null,             'Peerless Resort',      50000,  0, 12),
  ('Ripple Resort',                       'roundtrip',  null,             'Ripple Resort',        50000,  0, 12),
  ('Corbyn''s Cove Beach (from city)',    'roundtrip',  null,             'Corbyn''s Cove Beach', 70000,  0, 13),
  ('Corbyn''s Cove Beach (from Dollygunj Hotel)', 'roundtrip', 'Dollygunj', 'Corbyn''s Cove Beach', 80000, 0, 13),
  ('Corbyn''s Cove Beach (from Garacharma Hotel)', 'roundtrip', 'Garacharma', 'Corbyn''s Cove Beach', 90000, 0, 13),
  ('Baratang',                            'roundtrip',  null,             'Baratang Jetty',       450000, 0, 14),
  ('Baratang (from Idhaya)',              'roundtrip',  'Idhaya',         'Baratang Jetty',       600000, 0, 15),
  ('Baratang (from Adhvasaha)',           'roundtrip',  'Adhvasaha',      'Baratang Jetty',       600000, 0, 15),
  ('Baratang (from Symphony Samudra)',    'roundtrip',  'Symphony Samudra','Baratang Jetty',      650000, 0, 16),
  ('Baratang (from Sea Princess Resort)', 'roundtrip',  'Sea Princess Resort','Baratang Jetty',   650000, 0, 16),
  ('Kadamtala (1 night)',                 'outstation', null,             'Kadamtala',            950000,  1, 17),
  ('Rangat',                              'outstation', null,             'Rangat',               1400000, 1, 18),
  ('Mayabunder',                          'outstation', null,             'Mayabunder',           1700000, 2, 19),
  ('Diglipur (2N/3D)',                    'outstation', null,             'Diglipur',             2000000, 2, 20)
) as v(label, trip_type, from_label, to_label, fare_paise, nights, sort_order)
where not exists (
  select 1 from cab_rate_card existing
  where existing.island_slug = 'port-blair' and existing.label = v.label
);


-- ---------------------------------------------------------------------------
-- 4. cab_trip_details' trip_type widens for 'outstation'. Its existing
--    `days` column already covers a package's length (it already does this
--    job for a full-day hire) and `return_date` already covers the
--    arrival-back date, so nothing else here needs a new column.
-- ---------------------------------------------------------------------------

alter table cab_trip_details drop constraint if exists cab_trip_details_trip_type_check;
alter table cab_trip_details add constraint cab_trip_details_trip_type_check
  check (trip_type in ('oneway','roundtrip','fullday','outstation'));


-- ---------------------------------------------------------------------------
-- 5. The house partner every rate-card booking's partner_id/subject_id
--    anchors to. booking_items requires both NOT NULL, and a rate-card trip
--    has no self-service operator to point at instead. It carries no `cabs`
--    rows, so getCabOperators()'s existing "only operators with a listed car"
--    filter already keeps it out of the public marketplace for free.
-- ---------------------------------------------------------------------------

insert into partners (slug, name, kind, island_slug, status, blurb)
values (
  'andaman-go-cabs', 'Andaman Go Cabs', 'cab', 'port-blair', 'approved',
  'Andaman Go''s own dispatch fleet — standardized fares, a driver assigned after booking.'
)
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------------
-- 6. my_bookings (071) grows driver_name / driver_phone. Both come back null
--    until admin_assign_cab_driver (078) fills them in. security_invoker
--    means cab_drivers' own RLS (above) does the access control here — a
--    traveller only ever sees the driver on their own trip.
-- ---------------------------------------------------------------------------

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
  subject_maps_url(i.kind, i.subject_id, i.partner_id) as maps_url,
  subject_address(i.kind, i.subject_id, i.partner_id)  as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating,
  partner_phone(i.partner_id)         as operator_phone,
  i.refund_status,
  cd.name                             as driver_name,
  cd.phone                            as driver_phone
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug
left join cab_drivers cd on cd.id = i.driver_id;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


select 'cab rate card schema ready' as done,
  (select count(*) from cab_rate_card) as rates,
  (select count(*) from cab_places) as places;
