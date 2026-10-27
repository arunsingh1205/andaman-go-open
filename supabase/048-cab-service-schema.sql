-- ===========================================================================
-- Migration 048 — the Cab / car service, schema
--
-- Fills the slot 047 emptied. A cab operator is a partner (kind = 'cab'), the
-- way a rental shop is kind = 'rental'. Cars hang off the operator; each car
-- carries its own route fares — (from place, to place, one-way ₹, round-trip ₹)
-- — picked from an app-maintained list of named places. A full-day hire is a
-- flat ₹/day per car.
--
--   cab_places        — named points (Airport, Aberdeen Bazaar, jetties …),
--                       admin-maintained, with aliases that power the typeahead.
--   cabs              — one row per physical car.
--   cab_routes        — the fares a car serves.
--   cab_trip_details  — one row per cab booking_item (trip type, from/to, days).
--
-- Commission-free: commission_rates gets ('cab', 0). Payment is the new
-- 'contact' mode — the traveller picks ₹0 now (driver calls) or the full fare.
--
-- The kind-dispatch functions (subject_title, record_listing_view, the admin
-- approve/reject RPCs, set_listing_photos, the rating blend) and the booking
-- RPC live in migration 049.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. cab_places — the named points a trip runs between.
-- ---------------------------------------------------------------------------

create table if not exists cab_places (
  id          uuid primary key default gen_random_uuid(),
  island_slug text not null references islands(slug),
  label       text not null,
  aliases     text[] not null default '{}',   -- lowercased search terms
  is_airport  boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique (island_slug, label)
);

alter table cab_places enable row level security;

drop policy if exists "cab places are public" on cab_places;
create policy "cab places are public" on cab_places for select using (is_active);

drop policy if exists "admins see all cab places" on cab_places;
create policy "admins see all cab places" on cab_places for select using (is_admin());

grant select on cab_places to anon, authenticated;


-- Seed the Port Blair / South Andaman points. Idempotent on (island, label).
insert into cab_places (island_slug, label, aliases, is_airport, sort_order) values
  ('port-blair', 'Veer Savarkar International Airport',
     '{airport,veer savarkar,port blair airport,ixz,vsi}', true, 1),
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


-- ---------------------------------------------------------------------------
-- 2. cabs — one row per physical car, hanging off the operator partner.
-- ---------------------------------------------------------------------------

create table if not exists cabs (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,
  partner_id              uuid not null references partners(id) on delete cascade,
  category                text not null check (category in ('hatchback','sedan','suv','tempo')),
  model                   text not null,
  seats                   int  not null default 4 check (seats > 0),
  luggage                 int  not null default 0 check (luggage >= 0),
  ac                      boolean not null default true,
  fuel                    text not null check (fuel in ('ev','petrol','diesel')),   -- no CNG
  board_number            text,
  full_day_paise          int  not null default 0 check (full_day_paise >= 0),
  airport_surcharge_paise int  not null default 0 check (airport_surcharge_paise >= 0),
  night_surcharge_paise   int  not null default 0 check (night_surcharge_paise >= 0),
  per_km_paise            int  not null default 0 check (per_km_paise >= 0),   -- calculator hint only
  per_min_paise           int  not null default 0 check (per_min_paise >= 0),  -- calculator hint only
  meta                    text not null default '',
  photo_path              text,
  is_listed               boolean not null default false,
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  unique (partner_id, code)
);

create index if not exists cabs_partner_idx on cabs (partner_id, is_listed);

alter table cabs enable row level security;

drop policy if exists "listed cabs are public" on cabs;
create policy "listed cabs are public" on cabs
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = cabs.partner_id and p.status = 'approved'
    )
  );

drop policy if exists "partner sees own cabs" on cabs;
create policy "partner sees own cabs" on cabs
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid() and pu.partner_id = cabs.partner_id
    )
  );

drop policy if exists "admins see all cabs" on cabs;
create policy "admins see all cabs" on cabs for select using (is_admin());

grant select on cabs to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. cab_routes — the fares a car serves. Replaced wholesale by set_car_routes.
-- ---------------------------------------------------------------------------

create table if not exists cab_routes (
  id              uuid primary key default gen_random_uuid(),
  cab_id          uuid not null references cabs(id) on delete cascade,
  from_place_id   uuid not null references cab_places(id),
  to_place_id     uuid not null references cab_places(id),
  oneway_paise    int not null check (oneway_paise >= 0),
  roundtrip_paise int not null check (roundtrip_paise >= 0),
  check (from_place_id <> to_place_id),
  unique (cab_id, from_place_id, to_place_id)
);

alter table cab_routes enable row level security;

drop policy if exists "routes of a listed cab are public" on cab_routes;
create policy "routes of a listed cab are public" on cab_routes
  for select using (
    exists (
      select 1 from cabs c join partners p on p.id = c.partner_id
      where c.id = cab_routes.cab_id and c.is_listed and p.status = 'approved'
    )
  );

drop policy if exists "partner sees own cab routes" on cab_routes;
create policy "partner sees own cab routes" on cab_routes
  for select using (
    exists (
      select 1 from cabs c
      join partner_users pu on pu.partner_id = c.partner_id
      where c.id = cab_routes.cab_id and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all cab routes" on cab_routes;
create policy "admins see all cab routes" on cab_routes for select using (is_admin());

grant select on cab_routes to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. cab_trip_details — one row per cab booking_item.
-- ---------------------------------------------------------------------------

create table if not exists cab_trip_details (
  item_id       uuid primary key references booking_items(id) on delete cascade,
  trip_type     text not null check (trip_type in ('oneway','roundtrip','fullday')),
  from_place_id uuid references cab_places(id),
  to_place_id   uuid references cab_places(id),
  return_date   date,
  days          int not null default 1 check (days > 0),
  pickup_note   text not null default ''
);

alter table cab_trip_details enable row level security;

-- Readable through the booking it belongs to: the traveller who made it, or a
-- user linked to the operator, or an admin.
drop policy if exists "cab trip details follow the booking" on cab_trip_details;
create policy "cab trip details follow the booking" on cab_trip_details
  for select using (
    exists (
      select 1 from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = cab_trip_details.item_id
        and (
          b.user_id = auth.uid()
          or is_admin()
          or exists (
            select 1 from partner_users pu
            where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
          )
        )
    )
  );

grant select on cab_trip_details to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 5. booking_items grows what a cab booking needs.
--
--   cab_id  — which car. variant_id already FKs vehicles(id) and can't be
--             repointed, so cabs get their own column.
--   pay_mode 'none' — booked at ₹0, the whole fare owed to the driver.
-- ---------------------------------------------------------------------------

alter table booking_items add column if not exists cab_id uuid references cabs(id);

alter table booking_items drop constraint if exists booking_items_pay_mode_check;
alter table booking_items add constraint booking_items_pay_mode_check
  check (pay_mode in ('full', 'deposit', 'none'));


-- ---------------------------------------------------------------------------
-- 6. Every CHECK 047 tightened, now widened for 'cab'.
-- ---------------------------------------------------------------------------

alter table partners drop constraint if exists partners_kind_check;
alter table partners add constraint partners_kind_check
  check (kind in ('dive','ferry','restaurant','rental','venue','host','cab'));

alter table booking_items drop constraint if exists booking_items_kind_check;
alter table booking_items add constraint booking_items_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab'));

alter table availability drop constraint if exists availability_kind_check;
alter table availability add constraint availability_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab'));

alter table reviews drop constraint if exists reviews_kind_check;
alter table reviews add constraint reviews_kind_check
  check (kind in ('activity','table','event','trip','rental','cab'));

alter table listing_views drop constraint if exists listing_views_kind_check;
alter table listing_views add constraint listing_views_kind_check
  check (kind in ('activity','table','event','trip','rental','cab'));

alter table listing_photos drop constraint if exists listing_photos_listing_kind_check;
alter table listing_photos add constraint listing_photos_listing_kind_check
  check (listing_kind in ('activity','rental','table','event','trip','ferry','cab'));

alter table commission_rates drop constraint if exists commission_rates_kind_check;
alter table commission_rates add constraint commission_rates_kind_check
  check (kind in ('activity','ferry','table','event','trip','rental','cab'));

alter table category_payment drop constraint if exists category_payment_kind_check;
alter table category_payment add constraint category_payment_kind_check
  check (kind in ('activity','ferry','table','event','trip','rental','cab'));


-- ---------------------------------------------------------------------------
-- 7. Rate card + payment policy for the cab kind.
--    Commission-free, and the traveller chooses ₹0-now or full.
-- ---------------------------------------------------------------------------

-- 034 constrained category_payment.mode to free/full/choice — cabs add a
-- fourth mode, 'contact' (book at ₹0, the operator calls). Widen the CHECK
-- before the insert below can land the 'cab' row.
alter table category_payment drop constraint if exists category_payment_mode_check;
alter table category_payment add constraint category_payment_mode_check
  check (mode in ('free', 'full', 'choice', 'contact'));

insert into commission_rates (kind, bps) values ('cab', 0)
on conflict (kind) do nothing;

insert into category_payment (kind, mode) values ('cab', 'contact')
on conflict (kind) do nothing;

-- 034's set_category_payment only accepts free/full/choice — teach it 'contact'.
create or replace function set_category_payment(p_kind text, p_mode text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind not in ('activity','ferry','table','event','trip','rental','cab') then
    return query select false, 'Unknown category.'::text;
    return;
  end if;

  if p_mode not in ('free', 'full', 'choice', 'contact') then
    return query select false, 'Payment mode has to be free, full, choice or contact.'::text;
    return;
  end if;

  insert into category_payment (kind, mode, updated_at)
  values (p_kind, p_mode, now())
  on conflict (kind) do update set mode = excluded.mode, updated_at = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_category_payment(text, text) from public;
grant execute on function set_category_payment(text, text) to authenticated;

-- 025's set_commission_rate guard list.
create or replace function set_commission_rate(p_kind text, p_bps int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind not in ('activity','ferry','table','event','trip','rental','cab') then
    return query select false, 'Unknown category.'::text;
    return;
  end if;

  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    return query select false, 'Commission has to be between 0% and 100%.'::text;
    return;
  end if;

  insert into commission_rates (kind, bps, updated_at)
  values (p_kind, p_bps, now())
  on conflict (kind) do update set bps = excluded.bps, updated_at = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_commission_rate(text, int) from public;
grant execute on function set_commission_rate(text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. register_partner — 'cab' is a valid business category, 'stay' is not.
--    Body carried over from 011.
-- ---------------------------------------------------------------------------

create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null
) returns table (ok boolean, message text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_slug text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  select pu.partner_id into v_existing from partner_users pu where pu.user_id = auth.uid();
  if v_existing is not null then
    return query select false, 'This account is already linked to a business.'::text, v_existing;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Business name is required.'::text, null::uuid;
    return;
  end if;
  if p_kind not in ('dive', 'ferry', 'restaurant', 'rental', 'venue', 'host', 'cab') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (slug, name, kind, island_slug, contact_phone, address, maps_url, status)
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(trim(p_contact_phone), ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending'
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;

revoke all on function register_partner(text, text, text, text, text, text) from public;
grant execute on function register_partner(text, text, text, text, text, text) to authenticated;


select 'cab schema ready' as done,
  (select count(*) from cab_places) as places;
