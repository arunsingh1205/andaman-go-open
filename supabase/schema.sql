-- ===========================================================================
-- Andaman Go — schema
--
-- Paste this whole file into the Supabase SQL editor and press Run.
-- It is safe to run more than once: it drops and recreates everything.
--
-- Two ideas run through the whole file and are worth understanding before
-- you read it, because they are why the tables look the way they do.
--
-- 1. TIMETABLES ARE TEMPLATES, NOT ROWS PER DAY.
--    A dive shop does not have "9 AM on the 26th" in a table somewhere. It
--    has "we run at 9 AM, every day, six people". So we store the pattern,
--    and the app expands it into the next few days when it reads — exactly
--    what lib/activities.ts already does today, just fed from here.
--    Storing a row per day would mean a cron job forever, and a database
--    that quietly runs out of future.
--
-- 2. MONEY IS ALWAYS INTEGER PAISE.
--    Never numeric, never rupees. ₹3,500 is 350000. The same rule the app
--    already follows, enforced here by the column type.
-- ===========================================================================

drop table if exists booking_items cascade;
drop table if exists bookings cascade;
drop table if exists availability cascade;
drop table if exists activity_schedule cascade;
drop table if exists activities cascade;
drop table if exists restaurant_tables cascade;
drop table if exists restaurants cascade;
drop table if exists vehicles cascade;
drop table if exists sailings cascade;
drop table if exists events cascade;
drop table if exists trips cascade;
drop table if exists partners cascade;
drop table if exists islands cascade;


-- ---------------------------------------------------------------------------
-- Islands. One row per island, one canonical name.
--
-- This table exists because the app currently has three different names for
-- the same place — "Havelock" in rentals, "Swaraj Dweep" in trips, "Neil" in
-- the picker. Everything below points here, so that can't happen again.
-- ---------------------------------------------------------------------------

create table islands (
  slug           text primary key,
  name           text not null,          -- what travellers call it
  official_name  text not null,          -- what the government calls it
  sort_order     int  not null default 0
);


-- ---------------------------------------------------------------------------
-- Partners. Every business in the app is one row here: dive schools, ferry
-- companies, restaurants, rental shops, venues, cab operators and local hosts.
--
-- This is the table the partner app will write to and the admin console will
-- approve. `status` is why it exists — an unapproved partner is invisible to
-- travellers, and that rule lives in one place instead of seven.
-- ---------------------------------------------------------------------------

create table partners (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  name           text not null,
  kind           text not null check (kind in
                   ('dive','ferry','restaurant','rental','venue','host')),
  island_slug    text not null references islands(slug),
  contact_phone  text,
  -- Rental shops are the only partners a traveller browses directly, so their
  -- rating and blurb live here. Everywhere else these sit on the listing.
  rating         numeric(2,1),
  reviews        int not null default 0,
  distance_label text,
  blurb          text,
  status         text not null default 'approved'
                   check (status in ('pending','approved','suspended')),
  created_at     timestamptz not null default now()
);

create index partners_island_idx on partners (island_slug, status);


-- ---------------------------------------------------------------------------
-- Activities — scuba, sea walks, snorkelling, water sports.
-- ---------------------------------------------------------------------------

create table activities (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  partner_id   uuid not null references partners(id) on delete cascade,
  island_slug  text not null references islands(slug),
  category     text not null check (category in ('scuba','seawalk','snorkel','water')),
  mark         text not null,            -- the two letters on the list tile
  name         text not null,
  summary      text not null,
  about        text not null,
  price_paise  int  not null check (price_paise >= 0),
  rating       numeric(2,1) not null,
  reviews      int  not null default 0,
  is_listed    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index activities_island_idx on activities (island_slug, is_listed);

-- The recurring timetable. One row per departure time this activity runs.
-- `closed_reason` replaces the hardcoded "sea too rough" rule in the app:
-- a real closure is data an operator sets, not an if-statement.
create table activity_schedule (
  id             uuid primary key default gen_random_uuid(),
  activity_id    uuid not null references activities(id) on delete cascade,
  time_mins      int  not null check (time_mins between 0 and 1439),
  capacity       int  not null check (capacity > 0),
  days_of_week   int[] not null default '{0,1,2,3,4,5,6}',  -- 0 = Sunday
  closed_reason  text,
  unique (activity_id, time_mins)
);


-- ---------------------------------------------------------------------------
-- Ferries. A daily timetable, so the same template idea applies.
-- Arrival time is never stored — it is departure plus duration.
-- ---------------------------------------------------------------------------

create table sailings (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,   -- "gov", "makruzz" — stable, used in URLs
  partner_id     uuid not null references partners(id) on delete cascade,
  from_island    text not null references islands(slug),
  to_island      text not null references islands(slug),
  style_label    text not null,          -- the card badge: "Deluxe", "Popular"
  style_tone     text not null default 'plain' check (style_tone in ('good','warm','plain')),
  info           text not null default '',      -- a line under the fare, operator's words
  info_warn      boolean not null default false, -- show that line as a caution
  dep_mins       int  not null check (dep_mins between 0 and 1439),
  duration_mins  int  not null check (duration_mins > 0),
  fare_paise     int  not null check (fare_paise >= 0),
  capacity       int  not null check (capacity > 0),
  days_of_week   int[] not null default '{0,1,2,3,4,5,6}',
  is_listed      boolean not null default true
);

create index sailings_route_idx on sailings (from_island, to_island, is_listed);


-- ---------------------------------------------------------------------------
-- Restaurants and their table slots.
--
-- Note `capacity` on restaurant_tables is a number of TABLES, not seats.
-- The column is named tables_free-ish on purpose — this is exactly the
-- units mix-up that broke the Dine screen, so the schema says which it is.
-- ---------------------------------------------------------------------------

create table restaurants (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  partner_id   uuid not null references partners(id) on delete cascade,
  island_slug  text not null references islands(slug),
  category     text not null check (category in ('seafood','indian','continental','cafe')),
  mark         text not null,
  name         text not null,
  area         text not null,
  distance_label text not null,
  price_tier   int  not null check (price_tier between 1 and 3),  -- shown as ₹ / ₹₹ / ₹₹₹
  rating       numeric(2,1) not null,
  reviews      int  not null default 0,
  blurb        text not null,
  about        text not null,
  is_listed    boolean not null default true
);

create index restaurants_island_idx on restaurants (island_slug, is_listed);

create table restaurant_tables (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  time_mins      int  not null check (time_mins between 0 and 1439),
  table_count    int  not null check (table_count > 0),   -- TABLES, not seats
  seats_per_table int not null default 4 check (seats_per_table > 0),
  days_of_week   int[] not null default '{0,1,2,3,4,5,6}',
  unique (restaurant_id, time_mins)
);


-- ---------------------------------------------------------------------------
-- Rentals. The shop is the partner; vehicles hang off it.
-- ---------------------------------------------------------------------------

create table vehicles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,            -- "activa", "sprint" — stable in URLs
  partner_id   uuid not null references partners(id) on delete cascade,
  type         text not null check (type in ('scooter','bike','bicycle')),
  model        text not null,
  rate_paise   int  not null check (rate_paise >= 0),
  seats        int  not null default 2 check (seats > 0),
  meta         text not null,
  units        int  not null default 1 check (units > 0),  -- how many of this model
  is_listed    boolean not null default true,
  unique (partner_id, code)
);


-- ---------------------------------------------------------------------------
-- Events. Unlike everything above these are one-off dated things, so they
-- store a real date rather than a recurrence.
-- ---------------------------------------------------------------------------

create table events (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  partner_id   uuid not null references partners(id) on delete cascade,
  island_slug  text not null references islands(slug),
  genre        text not null check (genre in ('dj','live','bonfire','karaoke')),
  mark         text not null,
  name         text not null,
  venue        text not null,
  area         text not null,
  on_date      date not null,
  time_mins    int  not null check (time_mins between 0 and 1439),
  entry_paise  int  not null check (entry_paise >= 0),
  capacity     int  not null check (capacity > 0),
  rating       numeric(2,1) not null,
  reviews      int  not null default 0,
  about        text not null,
  is_listed    boolean not null default true
);

create index events_date_idx on events (island_slug, on_date, is_listed);


-- ---------------------------------------------------------------------------
-- Trips — a whole day, planned and run by someone who lives here.
-- ---------------------------------------------------------------------------

create table trips (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  partner_id      uuid not null references partners(id) on delete cascade,
  island_slug     text not null references islands(slug),
  title           text not null,
  host_name       text not null,
  host_since      text not null,
  duration_label  text not null,
  runs_on_days    int[] not null default '{0,1,2,3,4,5,6}',
  run_dates       date[] not null default '{}',
  departs_mins    int  not null default 360 check (departs_mins >= 0 and departs_mins < 1440),
  price_paise     int  not null check (price_paise >= 0),
  deposit_paise   int  not null check (deposit_paise >= 0),
  min_seats       int  not null check (min_seats > 0),
  seats_total     int  not null check (seats_total > 0),
  rating          numeric(2,1) not null,
  reviews         int  not null default 0,
  summary         text not null,
  includes        text[] not null default '{}',
  meet_point      text not null,
  meet_at_hotel   boolean not null default false,
  maps_url        text,
  is_listed       boolean not null default true,
  check (deposit_paise <= price_paise),
  check (min_seats <= seats_total)
);


-- Cabs / car hire live in migration 048 (cab_places, cabs, cab_routes,
-- cab_trip_details) — this baseline predates the service.


-- ---------------------------------------------------------------------------
-- Bookings.
--
-- A booking is a DAY, with one reference code, holding several items. That is
-- the whole "one booking, one refund" promise, written down as two tables.
-- If the weather cancels the ferry, you act on the booking, not the item.
-- ---------------------------------------------------------------------------

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  ref_code      text unique not null,
  user_id       uuid references auth.users(id) on delete set null,
  island_slug   text not null references islands(slug),
  on_date       date not null,
  created_at    timestamptz not null default now()
);

create index bookings_user_idx on bookings (user_id, on_date desc);

create table booking_items (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references bookings(id) on delete cascade,
  kind           text not null check (kind in
                   ('activity','ferry','table','event','rental','trip')),
  -- Which row in which catalogue table. Deliberately not a foreign key:
  -- seven nullable columns would be worse, and the kind tells you the table.
  subject_id     uuid not null,
  partner_id     uuid not null references partners(id),
  starts_at      timestamptz not null,
  party          int  not null check (party > 0),
  price_paise    int  not null check (price_paise >= 0),
  state          text not null default 'pending' check (state in
                   ('pending','confirmed','disrupted','completed','missed','refunded')),
  ticket_code    text,
  -- Where to collect the traveller, for a hotel-pickup trip (076). Null otherwise.
  pickup_address text,
  created_at     timestamptz not null default now()
);

create index booking_items_subject_idx on booking_items (kind, subject_id, starts_at);


-- ---------------------------------------------------------------------------
-- Availability — how many places are already taken, per thing, per moment.
--
-- Seats left is capacity minus this. It is a stored count rather than a live
-- count of booking_items for one reason: an anonymous visitor must be able to
-- read "3 seats left" without being able to read anybody's bookings. This
-- table holds numbers and nothing else, so it is safe to make public.
--
-- In the next phase a trigger on booking_items keeps it in step. Nothing
-- writes to it by hand.
-- ---------------------------------------------------------------------------

create table availability (
  kind        text not null check (kind in
                ('activity','ferry','table','event','rental','trip')),
  subject_id  uuid not null,
  starts_at   timestamptz not null,
  taken       int  not null default 0 check (taken >= 0),
  primary key (kind, subject_id, starts_at)
);


-- ===========================================================================
-- Row level security.
--
-- The key in the browser is the anon key, and anyone can read it out of the
-- page source. That is fine and expected — RLS is what actually protects the
-- data. Everything below says: the catalogue is public to read, and nothing
-- is public to write.
--
-- Every table needs a policy. A table with RLS on and no policy returns zero
-- rows, silently — which looks exactly like "my query is broken".
-- ===========================================================================

alter table islands            enable row level security;
alter table partners           enable row level security;
alter table activities         enable row level security;
alter table activity_schedule  enable row level security;
alter table sailings           enable row level security;
alter table restaurants        enable row level security;
alter table restaurant_tables  enable row level security;
alter table vehicles           enable row level security;
alter table events             enable row level security;
alter table trips              enable row level security;
alter table availability       enable row level security;
alter table bookings           enable row level security;
alter table booking_items      enable row level security;

-- The catalogue: readable by anyone, including logged-out visitors.
create policy "catalogue is public" on islands           for select using (true);
create policy "catalogue is public" on activity_schedule for select using (true);
create policy "catalogue is public" on sailings          for select using (true);
create policy "catalogue is public" on restaurant_tables for select using (true);
create policy "catalogue is public" on vehicles          for select using (true);
create policy "catalogue is public" on events            for select using (true);
create policy "catalogue is public" on trips             for select using (true);
create policy "counts are public"   on availability      for select using (true);

-- Partners and their listings: only approved ones are visible. This is the
-- admin queue enforced by the database rather than remembered in the app.
create policy "approved partners are public" on partners
  for select using (status = 'approved');

create policy "listed activities are public" on activities
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = partner_id and p.status = 'approved'
    )
  );

create policy "listed restaurants are public" on restaurants
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = partner_id and p.status = 'approved'
    )
  );

-- Bookings: yours and nobody else's. Logged out, you see none.
create policy "own bookings" on bookings
  for select using (auth.uid() = user_id);

create policy "own booking items" on booking_items
  for select using (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid())
  );

-- Nothing above grants insert, update or delete to anyone. Writes will go
-- through server-side code holding the service role key, which bypasses RLS.
-- That key never goes near the browser.
