-- ===========================================================================
-- Migration 096 — Stays & Homestays, schema
--
-- Replaces the restaurant slot 095 emptied out. A stay is a property
-- (homestay, guesthouse, villa, resort or hostel) run by a partner
-- (`partners.kind = 'stay'`), with one or more room types under it — a
-- small homestay is just one room type with quantity 1; a guesthouse with
-- three identical AC doubles is one room type with quantity 3.
--
-- Deliberately NOT the old flat `stays` table 047 dropped (one row, one
-- price, no rooms) and NOT a full Airbnb-scale property/room/rate-plan
-- model either — Andaman homestays are small, so "property + lightweight
-- room type, each with its own nightly rate and quantity" is the pragmatic
-- middle. Approval happens at the PROPERTY level only (`stays.is_listed`) —
-- room types are operational rows under an approved property, the same way
-- `restaurant_tables` were operational rows under an approved restaurant,
-- not separately reviewed the way each `cabs` row is under a cab operator.
--
-- Availability is booked by NIGHT, reusing the exact pattern 035 gave
-- rentals (which book by DAY): `booking_items.units` = nights,
-- `pg_advisory_xact_lock` + a peak-overlap count against `quantity`. No new
-- calendar table — a closed night is just a `listing_closures` row keyed on
-- the room type, same table every other kind already uses.
--
-- This migration is schema + the generic per-kind plumbing (subject_title,
-- photos, admin approve/reject/delete, location, closures) — commission,
-- payment mode and the actual booking RPC are 097.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------

create table if not exists stays (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references partners(id) on delete cascade,
  slug                text not null unique,
  mark                text not null,
  name                text not null,
  property_type       text not null
    check (property_type in ('homestay','guesthouse','villa','resort','hostel')),
  island_slug         text not null references islands(slug),
  area                text not null default '',
  address             text,
  maps_url            text,
  tagline             text not null default '',
  about               text not null default '',
  amenities           text[] not null default '{}',
  house_rules         text not null default '',
  cancellation_policy text not null default 'moderate'
    check (cancellation_policy in ('flexible','moderate','strict')),
  check_in_mins       int not null default 840  check (check_in_mins  between 0 and 1439),
  check_out_mins      int not null default 660  check (check_out_mins between 0 and 1439),
  rating              numeric,
  reviews             int not null default 0,
  seed_rating         numeric,
  seed_reviews        int not null default 0,
  photo_path          text,
  is_listed           boolean not null default false,
  rejection_reason    text,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists stays_island_idx on stays (island_slug, is_listed);
create index if not exists stays_partner_idx on stays (partner_id);

create table if not exists stay_room_types (
  id                 uuid primary key default gen_random_uuid(),
  stay_id            uuid not null references stays(id) on delete cascade,
  code               text not null,
  name               text not null,
  max_guests         int not null check (max_guests > 0),
  bedrooms           int not null default 1 check (bedrooms >= 0),
  beds               int not null default 1 check (beds > 0),
  bathrooms          int not null default 1 check (bathrooms >= 0),
  nightly_rate_paise int not null check (nightly_rate_paise >= 0),
  quantity           int not null default 1 check (quantity > 0),
  amenities          text[] not null default '{}',
  created_at         timestamptz not null default now(),
  unique (stay_id, code)
);

create index if not exists stay_room_types_stay_idx on stay_room_types (stay_id);

alter table booking_items add column if not exists stay_room_type_id uuid references stay_room_types(id);


-- ---------------------------------------------------------------------------
-- 2. Row level security — same shape as restaurants/activities: public sees
--    listed + approved-partner rows; a partner sees its own in any state;
--    admins see everything. No insert/update/delete policy on either table —
--    every write goes through a SECURITY DEFINER RPC below.
-- ---------------------------------------------------------------------------

alter table stays           enable row level security;
alter table stay_room_types enable row level security;

drop policy if exists "listed stays are public" on stays;
create policy "listed stays are public" on stays
  for select using (
    is_listed and deleted_at is null and exists (
      select 1 from partners p where p.id = partner_id and p.status = 'approved'
    )
  );

drop policy if exists "partner sees own stays" on stays;
create policy "partner sees own stays" on stays
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid() and pu.partner_id = stays.partner_id
    )
  );

drop policy if exists "admins see all stays" on stays;
create policy "admins see all stays" on stays for select using (is_admin());

drop policy if exists "listed stay room types are public" on stay_room_types;
create policy "listed stay room types are public" on stay_room_types
  for select using (
    exists (
      select 1 from stays s
      join partners p on p.id = s.partner_id
      where s.id = stay_room_types.stay_id
        and s.is_listed and s.deleted_at is null and p.status = 'approved'
    )
  );

drop policy if exists "partner sees own stay room types" on stay_room_types;
create policy "partner sees own stay room types" on stay_room_types
  for select using (
    exists (
      select 1 from stays s
      join partner_users pu on pu.partner_id = s.partner_id
      where s.id = stay_room_types.stay_id and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all stay room types" on stay_room_types;
create policy "admins see all stay room types" on stay_room_types for select using (is_admin());

grant select on stays, stay_room_types to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Widen every generic kind CHECK to allow 'stay'. All pure additions —
--    every existing row is already valid under the new, longer list.
-- ---------------------------------------------------------------------------

alter table partners drop constraint if exists partners_kind_check;
alter table partners add constraint partners_kind_check
  check (kind in ('dive','ferry','restaurant','rental','venue','host','cab','stay'));

alter table booking_items drop constraint if exists booking_items_kind_check;
alter table booking_items add constraint booking_items_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab','stay'));

-- booking_items_sync_availability (004) fires unconditionally on every insert
-- to booking_items, regardless of kind — including 'stay' — and writes a row
-- into `availability` keyed on that kind. Without 'stay' in this CHECK, every
-- single create_stay_booking insert would fail the instant the trigger tried
-- to write its availability row. create_stay_booking itself never reads this
-- table back (its own peak-load check reads booking_items directly), but the
-- trigger doesn't know that — it writes one regardless, same as it already
-- does for 'cab'.
alter table availability drop constraint if exists availability_kind_check;
alter table availability add constraint availability_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab','stay'));

alter table reviews drop constraint if exists reviews_kind_check;
alter table reviews add constraint reviews_kind_check
  check (kind in ('activity','table','event','trip','rental','cab','stay'));

alter table listing_views drop constraint if exists listing_views_kind_check;
alter table listing_views add constraint listing_views_kind_check
  check (kind in ('activity','table','event','trip','rental','cab','stay'));

alter table listing_photos drop constraint if exists listing_photos_listing_kind_check;
alter table listing_photos add constraint listing_photos_listing_kind_check
  check (listing_kind in ('activity','rental','table','event','trip','ferry','cab','stay'));

alter table listing_closures drop constraint if exists listing_closures_kind_check;
alter table listing_closures add constraint listing_closures_kind_check
  check (kind in ('activity','trip','rental','stay'));

alter table commission_rates drop constraint if exists commission_rates_kind_check;
alter table commission_rates add constraint commission_rates_kind_check
  check (kind in ('activity','ferry','event','trip','rental','cab','stay'));

alter table category_payment drop constraint if exists category_payment_kind_check;
alter table category_payment add constraint category_payment_kind_check
  check (kind in ('activity','ferry','event','trip','rental','cab','stay'));


-- ---------------------------------------------------------------------------
-- 4. register_partner — 'stay' joins the allow-list (095 removed
--    'restaurant' from here; this just re-widens with the new category).
-- ---------------------------------------------------------------------------

create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null,
  p_owner_email text default null,
  p_terms_accepted boolean default false
) returns table (ok boolean, message text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_slug text;
  v_id uuid;
  v_phone_clean text;
  v_phone_last10 text;
  v_dupe_id uuid;
  v_dupe_name text;
  v_owner_email text := lower(trim(coalesce(p_owner_email, '')));
  v_my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  -- Bump this whenever the wording at /partner-agreement changes materially,
  -- and match LAST_UPDATED.partnerAgreement in app/(legal)/legal-meta.ts.
  -- 2026-09-13: Stays & Homestays launch, 20% commission (096/097).
  v_terms_version constant text := '2026-09-13';
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return query select
      false,
      'Sign in with Google before registering your business.'::text,
      null::uuid;
    return;
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
  if p_kind not in ('dive', 'ferry', 'rental', 'venue', 'host', 'cab', 'stay') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;
  if not coalesce(p_terms_accepted, false) then
    return query select false, 'Please read and accept the Partner Agreement to register.'::text, null::uuid;
    return;
  end if;
  if v_owner_email <> '' and v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That backup email doesn''t look right.'::text, null::uuid;
    return;
  end if;

  v_phone_clean := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9+]', '', 'g');
  if v_phone_clean ~ '^[6-9][0-9]{9}$' then
    v_phone_clean := '+91' || v_phone_clean;
  elsif v_phone_clean ~ '^91[6-9][0-9]{9}$' then
    v_phone_clean := '+' || v_phone_clean;
  end if;
  v_phone_last10 := right(regexp_replace(v_phone_clean, '[^0-9]', '', 'g'), 10);

  if v_phone_last10 <> '' then
    select p.id, p.name into v_dupe_id, v_dupe_name
    from partners p
    where right(regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_last10
    limit 1;

    if v_dupe_id is not null then
      return query select
        false,
        format(
          'A business with this phone number is already registered (%s). If that''s you, sign out and sign back in with the Google account you used the first time. Message Andaman Go if you can''t get to it.',
          v_dupe_name
        ),
        v_dupe_id;
      return;
    end if;
  end if;

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (
    slug, name, kind, island_slug, contact_phone, address, maps_url, status,
    terms_accepted_at, terms_version
  )
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(v_phone_clean, ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending',
    now(), v_terms_version
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  if v_owner_email <> '' and v_owner_email <> v_my_email then
    insert into partner_invites (partner_id, email, role, invited_by)
    values (v_id, v_owner_email, 'owner', auth.uid());
  end if;

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;

revoke all on function register_partner(text, text, text, text, text, text, text, boolean) from public;
grant execute on function register_partner(text, text, text, text, text, text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. The generic kind-dispatch functions learn 'stay' -> `stays`, same as
--    'rental'/'cab' resolve to their own operator/shop rows. Bodies carried
--    over from 049, each with one branch added.
-- ---------------------------------------------------------------------------

create or replace function subject_title(p_kind text, p_subject_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'activity' then (select name from activities where id = p_subject_id)
    when 'ferry'    then (select fi.name || ' → ' || ti.name
                          from sailings s
                          join islands fi on fi.slug = s.from_island
                          join islands ti on ti.slug = s.to_island
                          where s.id = p_subject_id)
    when 'table'    then (select name from restaurants where id = p_subject_id)
    when 'event'    then (select name from events where id = p_subject_id)
    when 'trip'     then (select title from trips where id = p_subject_id)
    when 'rental'   then (select name from partners where id = p_subject_id)
    when 'cab'      then (select name from partners where id = p_subject_id)
    when 'stay'     then (select name from stays where id = p_subject_id)
  end
$$;

create or replace function record_listing_view(p_kind text, p_subject text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid;
  v_partner uuid;
begin
  case p_kind
    when 'activity' then
      select id, partner_id into v_subject, v_partner from activities where slug = p_subject;
    when 'table' then
      select id, partner_id into v_subject, v_partner from restaurants where slug = p_subject;
    when 'event' then
      select id, partner_id into v_subject, v_partner from events where slug = p_subject;
    when 'trip' then
      select id, partner_id into v_subject, v_partner from trips where slug = p_subject;
    when 'rental' then
      select id, id into v_subject, v_partner from partners where slug = p_subject;
    when 'cab' then
      select id, id into v_subject, v_partner from partners where slug = p_subject;
    when 'stay' then
      select id, partner_id into v_subject, v_partner from stays where slug = p_subject;
    else
      return;
  end case;

  if v_subject is null then
    return;
  end if;

  insert into listing_views (kind, subject_id, partner_id)
  values (p_kind, v_subject, v_partner);
end $$;

revoke all on function record_listing_view(text, text) from public;
grant execute on function record_listing_view(text, text) to anon, authenticated;

create or replace function recompute_listing_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind    text := coalesce(new.kind, old.kind);
  v_subject uuid := coalesce(new.subject_id, old.subject_id);
  v_seed_r  numeric;
  v_seed_c  int;
  v_real_sum bigint;
  v_real_cnt int;
  v_total   int;
  v_blend   numeric;
begin
  select coalesce(sum(rating), 0), count(*)
    into v_real_sum, v_real_cnt
  from reviews where kind = v_kind and subject_id = v_subject;

  if v_kind = 'activity' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from activities where id = v_subject;
  elsif v_kind = 'table' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from restaurants where id = v_subject;
  elsif v_kind = 'event' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from events where id = v_subject;
  elsif v_kind = 'trip' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from trips where id = v_subject;
  elsif v_kind in ('rental', 'cab') then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from partners where id = v_subject;
  elsif v_kind = 'stay' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from stays where id = v_subject;
  else
    return null;
  end if;

  v_seed_r := coalesce(v_seed_r, 0);
  v_seed_c := coalesce(v_seed_c, 0);
  v_total  := v_seed_c + v_real_cnt;

  if v_total = 0 then
    return null;
  end if;

  v_blend := round((v_seed_r * v_seed_c + v_real_sum) / v_total, 1);

  if v_kind = 'activity' then
    update activities set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'table' then
    update restaurants set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'event' then
    update events set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'trip' then
    update trips set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind in ('rental', 'cab') then
    update partners set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'stay' then
    update stays set rating = v_blend, reviews = v_total where id = v_subject;
  end if;

  return null;
end $$;

create or replace function listing_reviews(p_kind text, p_subject text)
returns table (rating int, body text, reply text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  case p_kind
    when 'activity' then select id into v_id from activities where slug = p_subject;
    when 'table'    then select id into v_id from restaurants where slug = p_subject;
    when 'event'    then select id into v_id from events where slug = p_subject;
    when 'trip'     then select id into v_id from trips where slug = p_subject;
    when 'rental'   then select id into v_id from partners where slug = p_subject;
    when 'cab'      then select id into v_id from partners where slug = p_subject;
    when 'stay'     then select id into v_id from stays where slug = p_subject;
    else return;
  end case;

  if v_id is null then
    return;
  end if;

  return query
    select r.rating, r.body, r.reply, r.created_at
    from reviews r
    where r.kind = p_kind and r.subject_id = v_id
    order by r.created_at desc;
end $$;

revoke all on function listing_reviews(text, text) from public;
grant execute on function listing_reviews(text, text) to anon, authenticated;

create or replace function listing_partner_id(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_kind
    when 'activity' then select partner_id into v from activities  where id = p_id;
    when 'rental'   then select partner_id into v from vehicles    where id = p_id;
    when 'cab'      then select partner_id into v from cabs        where id = p_id;
    when 'table'    then select partner_id into v from restaurants where id = p_id;
    when 'event'    then select partner_id into v from events      where id = p_id;
    when 'trip'     then select partner_id into v from trips       where id = p_id;
    when 'ferry'    then select partner_id into v from sailings    where id = p_id;
    when 'stay'     then select partner_id into v from stays       where id = p_id;
    else v := null;
  end case;
  return v;
end $$;

revoke all on function listing_partner_id(text, uuid) from public;
grant execute on function listing_partner_id(text, uuid) to anon, authenticated;

create or replace function listing_is_public(p_kind text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  case p_kind
    when 'activity' then select x.is_listed and p.status = 'approved' into v
      from activities x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'rental' then select x.is_listed and p.status = 'approved' into v
      from vehicles x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'cab' then select x.is_listed and p.status = 'approved' into v
      from cabs x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'table' then select x.is_listed and p.status = 'approved' into v
      from restaurants x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'event' then select x.is_listed and p.status = 'approved' into v
      from events x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'trip' then select x.is_listed and p.status = 'approved' into v
      from trips x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'ferry' then select x.is_listed and p.status = 'approved' into v
      from sailings x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'stay' then select x.is_listed and p.status = 'approved' into v
      from stays x join partners p on p.id = x.partner_id where x.id = p_id;
    else v := false;
  end case;
  return coalesce(v, false);
end $$;

revoke all on function listing_is_public(text, uuid) from public;
grant execute on function listing_is_public(text, uuid) to anon, authenticated;

create or replace function set_listing_photos(p_kind text, p_id uuid, p_paths text[])
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_owner   uuid;
  v_table   text;
  v_cover   text;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  v_table := case p_kind
    when 'activity' then 'activities' when 'rental' then 'vehicles'
    when 'cab' then 'cabs' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' when 'stay' then 'stays' else null end;
  if v_table is null then
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  v_owner := listing_partner_id(p_kind, p_id);
  if v_owner is null or v_owner <> v_partner then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  delete from listing_photos where listing_kind = p_kind and listing_id = p_id;

  insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select p_kind, p_id, t.path, t.ord - 1
  from unnest(coalesce(p_paths, '{}'::text[])) with ordinality as t(path, ord)
  where coalesce(trim(t.path), '') <> ''
  on conflict (listing_kind, listing_id, storage_path) do nothing;

  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_listing_photos(text, uuid, text[]) from public;
grant execute on function set_listing_photos(text, uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. subject_address / subject_maps_url — a stay's own address/pin, falling
--    back to the business profile (071). stays carries its own columns
--    directly (built into this migration, unlike restaurants/activities
--    which got theirs bolted on later).
-- ---------------------------------------------------------------------------

create or replace function subject_address(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(address), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(address), '') from restaurants where id = p_subject_id)
      when 'stay'     then (select nullif(trim(address), '') from stays       where id = p_subject_id)
    end,
    partner_address(p_partner_id)
  )
$$;

create or replace function subject_maps_url(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(maps_url), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(maps_url), '') from restaurants where id = p_subject_id)
      when 'stay'     then (select nullif(trim(maps_url), '') from stays       where id = p_subject_id)
    end,
    partner_maps_url(p_partner_id)
  )
$$;

revoke all on function subject_address(text, uuid, uuid)  from public;
revoke all on function subject_maps_url(text, uuid, uuid) from public;
grant execute on function subject_address(text, uuid, uuid)  to authenticated, anon;
grant execute on function subject_maps_url(text, uuid, uuid) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 7. Admin approve / reject / unlist / resubmit / delete — a 'stay' branch
--    each. Bodies carried over from 072/093. Approving a stay requires at
--    least one room type, same gate activities/restaurants have for their
--    schedule.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_listing(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind = 'activity' and not exists (select 1 from activity_schedule where activity_id = p_id) then
    return query select false, 'Add at least one time slot before approving this activity.'::text;
    return;
  end if;
  if p_kind = 'table' and not exists (select 1 from restaurant_tables where restaurant_id = p_id) then
    return query select false, 'Add at least one table sitting before approving this restaurant.'::text;
    return;
  end if;
  if p_kind = 'stay' and not exists (select 1 from stay_room_types where stay_id = p_id) then
    return query select false, 'Add at least one room type before approving this stay.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Approved.'::text;
end $$;

create or replace function admin_reject_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before rejecting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Rejected.'::text;
end $$;

create or replace function admin_unlist_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before unlisting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing is not live right now.'::text;
    return;
  end if;

  return query select true, 'Taken down.'::text;
end $$;

revoke all on function admin_unlist_listing(text, uuid, text) from public;
grant execute on function admin_unlist_listing(text, uuid, text) to authenticated;

create or replace function resubmit_partner_listing_impl(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_hit boolean := false;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_kind = 'activity' then
    update activities set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'Nothing to resubmit.'::text;
    return;
  end if;

  return query select true, 'Sent back to Andaman Go for another look.'::text;
end $$;

revoke all on function resubmit_partner_listing_impl(text, uuid) from public, anon, authenticated;

create or replace function admin_delete_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before deleting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing is already deleted, or no longer exists.'::text;
    return;
  end if;

  return query select true, 'Deleted.'::text;
end;
$$;

revoke all on function admin_delete_listing(text, uuid, text) from public;
grant execute on function admin_delete_listing(text, uuid, text) to authenticated;

create or replace function delete_partner_listing_impl(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_hit boolean := false;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end;
$$;

revoke all on function delete_partner_listing_impl(text, uuid) from public, anon, authenticated;

-- admin_delete_partner also unlists everything a deleted business owns —
-- add stays to that sweep. Body carried over from 093.
create or replace function admin_delete_partner(p_partner_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before deleting.'::text;
    return;
  end if;

  select status into v_status from partners where id = p_partner_id for update;

  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  if v_status = 'deleted' then
    return query select false, 'That business is already deleted.'::text;
    return;
  end if;

  update partners
  set status = 'deleted', rejection_reason = trim(p_reason)
  where id = p_partner_id;

  update activities          set is_listed = false where partner_id = p_partner_id and is_listed;
  update vehicles            set is_listed = false where partner_id = p_partner_id and is_listed;
  update cabs                set is_listed = false where partner_id = p_partner_id and is_listed;
  update restaurants         set is_listed = false where partner_id = p_partner_id and is_listed;
  update events              set is_listed = false where partner_id = p_partner_id and is_listed;
  update trips               set is_listed = false where partner_id = p_partner_id and is_listed;
  update sailings            set is_listed = false where partner_id = p_partner_id and is_listed;
  update community_services  set is_listed = false where partner_id = p_partner_id and is_listed;
  update stays               set is_listed = false where partner_id = p_partner_id and is_listed;

  return query select true, 'Deleted.'::text;
end;
$$;

revoke all on function admin_delete_partner(uuid, text) from public;
grant execute on function admin_delete_partner(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Location + photos, admin side. Bodies carried over from 075, each with
--    a 'stay' branch added.
-- ---------------------------------------------------------------------------

create or replace function admin_set_listing_location(
  p_kind text, p_id uuid, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_kind = 'activity' then
    update activities set
      address  = nullif(trim(p_address), ''),
      maps_url = nullif(trim(p_maps_url), '')
    where id = p_id;
  elsif p_kind = 'table' then
    update restaurants set
      address  = nullif(trim(p_address), ''),
      maps_url = nullif(trim(p_maps_url), '')
    where id = p_id;
  elsif p_kind = 'stay' then
    update stays set
      address  = nullif(trim(p_address), ''),
      maps_url = nullif(trim(p_maps_url), '')
    where id = p_id;
  else
    return query select false, 'That listing type has no separate location.'::text;
    return;
  end if;

  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_listing_location(text, uuid, text, text) from public;
grant execute on function admin_set_listing_location(text, uuid, text, text) to authenticated;

create or replace function admin_set_listing_photos(p_kind text, p_id uuid, p_paths text[])
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_table text;
  v_cover text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_table := case p_kind
    when 'activity' then 'activities' when 'rental' then 'vehicles'
    when 'cab' then 'cabs' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' when 'stay' then 'stays' else null end;
  if v_table is null then
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if listing_partner_id(p_kind, p_id) is null then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  delete from listing_photos where listing_kind = p_kind and listing_id = p_id;

  insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select p_kind, p_id, t.path, t.ord - 1
  from unnest(coalesce(p_paths, '{}'::text[])) with ordinality as t(path, ord)
  where coalesce(trim(t.path), '') <> ''
  on conflict (listing_kind, listing_id, storage_path) do nothing;

  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_listing_photos(text, uuid, text[]) from public;
grant execute on function admin_set_listing_photos(text, uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Closures — a stay's room type is the closeable subject, exactly as a
--    rental's is the shop itself. Bodies carried over from 035, one branch
--    added to each.
-- ---------------------------------------------------------------------------

create or replace function close_partner_date(
  p_kind text,
  p_subject_id uuid,
  p_on_date date,
  p_reason text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_owns    boolean := false;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason — travellers see this.'::text;
    return;
  end if;

  if p_on_date < (now() at time zone 'Asia/Kolkata')::date then
    return query select false, 'That date has already passed.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    v_owns := exists (select 1 from activities where id = p_subject_id and partner_id = v_partner);
  elsif p_kind = 'trip' then
    v_owns := exists (select 1 from trips where id = p_subject_id and partner_id = v_partner);
  elsif p_kind = 'rental' then
    v_owns := (p_subject_id = v_partner);
  elsif p_kind = 'stay' then
    v_owns := exists (
      select 1 from stay_room_types rt
      join stays s on s.id = rt.stay_id
      where rt.id = p_subject_id and s.partner_id = v_partner
    );
  else
    return query select false, 'That kind of listing can''t be closed by date yet.'::text;
    return;
  end if;

  if not v_owns then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  insert into listing_closures (partner_id, kind, subject_id, on_date, reason)
  values (v_partner, p_kind, p_subject_id, p_on_date, trim(p_reason))
  on conflict (kind, subject_id, on_date)
  do update set reason = excluded.reason;

  return query select true, 'Closed.'::text;
end $$;

revoke all on function close_partner_date(text, uuid, date, text) from public;
grant execute on function close_partner_date(text, uuid, date, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. add_partner_stay / update_partner_stay / set_partner_stay_location —
--     same shape as the restaurant CRUD (016/017/071), minus the schedule
--     (room types are a separate bulk-replace RPC below, same discipline as
--     set_car_routes: operational, doesn't bounce a live listing to pending).
-- ---------------------------------------------------------------------------

create or replace function add_partner_stay(
  p_name               text,
  p_property_type      text,
  p_area               text,
  p_tagline            text default '',
  p_about              text default '',
  p_amenities          text[] default '{}',
  p_house_rules        text default '',
  p_cancellation_policy text default 'moderate',
  p_check_in_mins      int default 840,
  p_check_out_mins     int default 660,
  p_photo_path         text default null
) returns table (ok boolean, message text, stay_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;
  if not exists (select 1 from partners where id = v_partner and kind = 'stay') then
    return query select false, 'This business is not registered as a stay.'::text, null::uuid;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text, null::uuid;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel') then
    return query select false, 'Choose a valid property type.'::text, null::uuid;
    return;
  end if;
  if p_cancellation_policy not in ('flexible','moderate','strict') then
    return query select false, 'Choose a valid cancellation policy.'::text, null::uuid;
    return;
  end if;
  if p_check_in_mins is null or p_check_in_mins not between 0 and 1439
     or p_check_out_mins is null or p_check_out_mins not between 0 and 1439 then
    return query select false, 'Choose valid check-in and check-out times.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'stays');

  insert into stays (
    slug, partner_id, island_slug, mark, name, property_type, area, tagline, about,
    amenities, house_rules, cancellation_policy, check_in_mins, check_out_mins,
    is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, v_mark, trim(p_name), p_property_type,
    coalesce(nullif(trim(p_area), ''), 'Near the property'),
    coalesce(trim(p_tagline), ''), coalesce(trim(p_about), ''),
    coalesce(p_amenities, '{}'), coalesce(trim(p_house_rules), ''), p_cancellation_policy,
    p_check_in_mins, p_check_out_mins, false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. Add your room types next, then submit for review.'::text, v_id;
end $$;

revoke all on function add_partner_stay(
  text, text, text, text, text, text[], text, text, int, int, text
) from public;
grant execute on function add_partner_stay(
  text, text, text, text, text, text[], text, text, int, int, text
) to authenticated;


create or replace function update_partner_stay(
  p_id                 uuid,
  p_name               text,
  p_property_type      text,
  p_area               text,
  p_tagline            text default '',
  p_about              text default '',
  p_amenities          text[] default '{}',
  p_house_rules        text default '',
  p_cancellation_policy text default 'moderate',
  p_check_in_mins      int default 840,
  p_check_out_mins     int default 660,
  p_photo_path         text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel') then
    return query select false, 'Choose a valid property type.'::text;
    return;
  end if;
  if p_cancellation_policy not in ('flexible','moderate','strict') then
    return query select false, 'Choose a valid cancellation policy.'::text;
    return;
  end if;
  if p_check_in_mins is null or p_check_in_mins not between 0 and 1439
     or p_check_out_mins is null or p_check_out_mins not between 0 and 1439 then
    return query select false, 'Choose valid check-in and check-out times.'::text;
    return;
  end if;

  select is_listed into v_was_listed from stays where id = p_id and partner_id = v_partner;
  if v_was_listed is null then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update stays set
    name = trim(p_name),
    property_type = p_property_type,
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    tagline = coalesce(trim(p_tagline), ''),
    about = coalesce(trim(p_about), ''),
    amenities = coalesce(p_amenities, '{}'),
    house_rules = coalesce(trim(p_house_rules), ''),
    cancellation_policy = p_cancellation_policy,
    check_in_mins = p_check_in_mins,
    check_out_mins = p_check_out_mins,
    photo_path = coalesce(p_photo_path, photo_path),
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end $$;

revoke all on function update_partner_stay(
  uuid, text, text, text, text, text, text[], text, text, int, int, text
) from public;
grant execute on function update_partner_stay(
  uuid, text, text, text, text, text, text[], text, text, int, int, text
) to authenticated;


create or replace function set_partner_stay_location(
  p_id uuid, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from stays where id = p_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update stays set
    address  = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), '')
  where id = p_id and partner_id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_stay_location(uuid, text, text) from public;
grant execute on function set_partner_stay_location(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. set_stay_room_types — replace one stay's whole room-type set in a
--     single transaction, same bulk-replace discipline as set_car_routes
--     (049): operational, does NOT bounce a live listing back to pending.
--     p_room_types is a jsonb array of
--       { code, name, max_guests, bedrooms, beds, bathrooms,
--         nightly_rate_paise, quantity, amenities }.
-- ---------------------------------------------------------------------------

create or replace function set_stay_room_types(p_stay_id uuid, p_room_types jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_row     jsonb;
  v_count   int;
  v_seen_codes text[] := '{}';
  v_code    text;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from stays where id = p_stay_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if p_room_types is null or jsonb_typeof(p_room_types) <> 'array' then
    return query select false, 'Add at least one room type.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_room_types);
  if v_count = 0 then
    return query select false, 'Add at least one room type.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many room types — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_row in select * from jsonb_array_elements(p_room_types) loop
    if coalesce(trim(v_row->>'name'), '') = '' then
      return query select false, 'Every room type needs a name.'::text;
      return;
    end if;
    if coalesce((v_row->>'max_guests')::int, 0) < 1 then
      return query select false, 'Every room type needs a maximum guest count.'::text;
      return;
    end if;
    if (v_row->>'nightly_rate_paise') is null or (v_row->>'nightly_rate_paise')::int < 0 then
      return query select false, 'Every room type needs a nightly rate.'::text;
      return;
    end if;
    if coalesce((v_row->>'quantity')::int, 1) < 1 then
      return query select false, 'Every room type needs at least one unit.'::text;
      return;
    end if;

    v_code := nullif(trim(coalesce(v_row->>'code', '')), '');
    if v_code is null then
      v_code := trim(both '-' from regexp_replace(lower(v_row->>'name'), '[^a-z0-9]+', '-', 'g'))
        || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    end if;
    if v_code = any (v_seen_codes) then
      return query select false, 'Two room types ended up with the same code — try again.'::text;
      return;
    end if;
    v_seen_codes := array_append(v_seen_codes, v_code);
  end loop;

  delete from stay_room_types where stay_id = p_stay_id;

  insert into stay_room_types (
    stay_id, code, name, max_guests, bedrooms, beds, bathrooms,
    nightly_rate_paise, quantity, amenities
  )
  select
    p_stay_id,
    coalesce(
      nullif(trim(r->>'code'), ''),
      trim(both '-' from regexp_replace(lower(r->>'name'), '[^a-z0-9]+', '-', 'g'))
        || '-' || substr(md5(random()::text || clock_timestamp()::text || r::text), 1, 4)
    ),
    trim(r->>'name'),
    greatest((r->>'max_guests')::int, 1),
    greatest(coalesce((r->>'bedrooms')::int, 1), 0),
    greatest(coalesce((r->>'beds')::int, 1), 1),
    greatest(coalesce((r->>'bathrooms')::int, 1), 0),
    greatest((r->>'nightly_rate_paise')::int, 0),
    greatest(coalesce((r->>'quantity')::int, 1), 1),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'amenities', '[]'::jsonb)) x), '{}')
  from jsonb_array_elements(p_room_types) r;

  return query select true, 'Room types saved.'::text;
end $$;

revoke all on function set_stay_room_types(uuid, jsonb) from public;
grant execute on function set_stay_room_types(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 12. Admin twins — admin_update_stay, admin_set_stay_room_types. Bodies
--     mirror admin_update_restaurant/admin_set_restaurant_tables (075).
-- ---------------------------------------------------------------------------

create or replace function admin_update_stay(
  p_id uuid, p_name text, p_property_type text, p_area text, p_tagline text,
  p_about text, p_amenities text[], p_house_rules text, p_cancellation_policy text,
  p_check_in_mins int, p_check_out_mins int
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel') then
    return query select false, 'Choose a valid property type.'::text;
    return;
  end if;

  update stays set
    name = trim(p_name),
    property_type = p_property_type,
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    tagline = coalesce(trim(p_tagline), ''),
    about = coalesce(trim(p_about), ''),
    amenities = coalesce(p_amenities, '{}'),
    house_rules = coalesce(trim(p_house_rules), ''),
    cancellation_policy = coalesce(p_cancellation_policy, cancellation_policy),
    check_in_mins = coalesce(p_check_in_mins, check_in_mins),
    check_out_mins = coalesce(p_check_out_mins, check_out_mins)
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_stay(
  uuid, text, text, text, text, text, text[], text, text, int, int
) from public;
grant execute on function admin_update_stay(
  uuid, text, text, text, text, text, text[], text, text, int, int
) to authenticated;

create or replace function admin_set_stay_room_types(p_stay_id uuid, p_room_types jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_row   jsonb;
  v_count int;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if not exists (select 1 from stays where id = p_stay_id) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if p_room_types is null or jsonb_typeof(p_room_types) <> 'array' then
    return query select false, 'Add at least one room type.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_room_types);
  if v_count = 0 then
    return query select false, 'Add at least one room type.'::text;
    return;
  end if;

  for v_row in select * from jsonb_array_elements(p_room_types) loop
    if coalesce(trim(v_row->>'name'), '') = '' then
      return query select false, 'Every room type needs a name.'::text;
      return;
    end if;
  end loop;

  delete from stay_room_types where stay_id = p_stay_id;

  insert into stay_room_types (
    stay_id, code, name, max_guests, bedrooms, beds, bathrooms,
    nightly_rate_paise, quantity, amenities
  )
  select
    p_stay_id,
    coalesce(
      nullif(trim(r->>'code'), ''),
      trim(both '-' from regexp_replace(lower(r->>'name'), '[^a-z0-9]+', '-', 'g'))
        || '-' || substr(md5(random()::text || clock_timestamp()::text || r::text), 1, 4)
    ),
    trim(r->>'name'),
    greatest(coalesce((r->>'max_guests')::int, 1), 1),
    greatest(coalesce((r->>'bedrooms')::int, 1), 0),
    greatest(coalesce((r->>'beds')::int, 1), 1),
    greatest(coalesce((r->>'bathrooms')::int, 1), 0),
    greatest(coalesce((r->>'nightly_rate_paise')::int, 0), 0),
    greatest(coalesce((r->>'quantity')::int, 1), 1),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'amenities', '[]'::jsonb)) x), '{}')
  from jsonb_array_elements(p_room_types) r;

  return query select true, 'Room types saved.'::text;
end $$;

revoke all on function admin_set_stay_room_types(uuid, jsonb) from public;
grant execute on function admin_set_stay_room_types(uuid, jsonb) to authenticated;


select 'stays schema installed' as done, (select count(*) from stays) as stays_rows;
