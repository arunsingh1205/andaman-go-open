-- Partner self-onboarding.
--
-- Up to now every partner login was something Arun set up by hand. From here
-- a partner who signs in and isn't linked to a business yet can register
-- themselves — business details first, then their activities/vehicles/rooms
-- one at a time — and everything they submit lands in front of Arun for
-- review before a traveller ever sees it. Two gates, not one:
--   - `partners.status` gates the *business* (pending until Arun checks the
--     address, license, contact details).
--   - `is_listed` on each catalogue row gates the *listing* (pending until
--     Arun checks that specific activity/vehicle/room).
-- A partner can keep adding listings while their business is still pending —
-- nothing they submit reaches a traveller until BOTH gates are open, which
-- is exactly what the tightened policies below enforce.

-- ---------------------------------------------------------------------------
-- Security fix, found while wiring this up: sailings, vehicles, events and
-- trips were still on the original "catalogue is public" policy (USING
-- (true)) from before `is_listed` and partner `status` existed. Activities
-- and restaurants were already tightened. That gap meant an unlisted row —
-- and after this migration, every self-submitted, not-yet-approved
-- listing — was readable by anyone with the public anon key, straight
-- through the table. Closing it here, before partners start inserting real
-- pending rows into vehicles and stays.
-- ---------------------------------------------------------------------------

drop policy "catalogue is public" on sailings;
create policy "listed sailings are public" on sailings
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = sailings.partner_id and p.status = 'approved'
    )
  );

drop policy "catalogue is public" on vehicles;
create policy "listed vehicles are public" on vehicles
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = vehicles.partner_id and p.status = 'approved'
    )
  );

drop policy "catalogue is public" on events;
create policy "listed events are public" on events
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = events.partner_id and p.status = 'approved'
    )
  );

drop policy "catalogue is public" on trips;
create policy "listed trips are public" on trips
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = trips.partner_id and p.status = 'approved'
    )
  );

drop policy "catalogue is public" on stays;
create policy "listed stays are public" on stays
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = stays.partner_id and p.status = 'approved'
    )
  );

-- A partner needs to see their own pending work too — their own rows,
-- regardless of is_listed or their business's approval state. Additive to
-- the public policies above (Postgres OR's same-command policies together).

create policy "partner sees own vehicles" on vehicles
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = vehicles.partner_id)
  );

create policy "partner sees own stays" on stays
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = stays.partner_id)
  );

create policy "partner sees own activities" on activities
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = activities.partner_id)
  );

-- A partner also needs to read their own business row before Arun approves
-- it — "approved partners are public" only ever showed approved ones.

create policy "partner sees own business" on partners
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = partners.id)
  );

-- ---------------------------------------------------------------------------
-- New partner-facing details. All nullable — a partner fills these in during
-- registration and while adding listings, not before.
-- ---------------------------------------------------------------------------

alter table partners add column address           text;
alter table partners add column maps_url          text;   -- Google Maps share link, for traveller directions
alter table partners add column cover_photo_path  text;   -- storage path in the partner-photos bucket
alter table partners add column license_number    text;
alter table partners add column license_doc_path  text;   -- storage path in the partner-licenses bucket

alter table activities add column photo_path text;
alter table vehicles   add column photo_path text;
alter table stays      add column photo_path text;

-- ---------------------------------------------------------------------------
-- Slug generation shared by every self-serve insert below. `p_table` is
-- always a literal passed by the functions in this file, never client input,
-- so the dynamic SQL here carries no injection risk.
-- ---------------------------------------------------------------------------

create or replace function unique_slug(p_base text, p_table text) returns text
language plpgsql set search_path = public as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(p_base), '[^a-z0-9]+', '-', 'g'));
  v_candidate text;
  v_exists boolean;
begin
  if v_base = '' then
    v_base := 'listing';
  end if;
  loop
    v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    execute format('select exists(select 1 from %I where slug = $1)', p_table) into v_exists using v_candidate;
    exit when not v_exists;
  end loop;
  return v_candidate;
end;
$$;

revoke all on function unique_slug(text, text) from public;
grant execute on function unique_slug(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- register_partner — a signed-in-but-unlinked user creates their own
-- business (status = 'pending') and links themselves to it as owner, in one
-- step. Mirrors confirm_booking/decline_booking's guard style.
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
  if p_kind not in ('dive', 'ferry', 'restaurant', 'rental', 'venue', 'stay', 'host') then
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
    v_slug,
    trim(p_name),
    p_kind,
    p_island_slug,
    nullif(trim(p_contact_phone), ''),
    nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''),
    'pending'
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end;
$$;

revoke all on function register_partner(text, text, text, text, text, text) from public;
grant execute on function register_partner(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_partner_profile — everything a partner fills in after registering:
-- the cover photo, the license (only the categories that need one bother
-- asking, but nothing stops any partner from adding one). Always overwrites
-- with what the client sends, same as the registration form it follows —
-- the client always submits the complete current values, not a partial diff.
-- ---------------------------------------------------------------------------

create or replace function update_partner_profile(
  p_address text,
  p_maps_url text,
  p_cover_photo_path text,
  p_license_number text,
  p_license_doc_path text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partners set
    address = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), ''),
    cover_photo_path = p_cover_photo_path,
    license_number = nullif(trim(p_license_number), ''),
    license_doc_path = p_license_doc_path
  where id = v_partner;

  return query select true, 'Saved.'::text;
end;
$$;

revoke all on function update_partner_profile(text, text, text, text, text) from public;
grant execute on function update_partner_profile(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_partner_activity / add_partner_vehicle / add_partner_stay — the three
-- self-serve "add a listing" forms Arun asked for first (jet ski / banana
-- ride, a scooty, a deluxe queen room). Same shape as confirm_booking: look
-- up the caller's own partner_id, never trust one from the client. Every
-- insert lands with is_listed = false.
-- ---------------------------------------------------------------------------

create or replace function add_partner_activity(
  p_category text,
  p_name text,
  p_summary text,
  p_about text,
  p_price_paise int,
  p_photo_path text default null
) returns table (ok boolean, message text, activity_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_mark text;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_category not in ('scuba', 'seawalk', 'snorkel', 'water') then
    return query select false, 'Choose a valid activity category.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'activities');

  insert into activities (
    slug, partner_id, island_slug, category, mark, name, summary, about,
    price_paise, rating, reviews, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_category, v_mark, trim(p_name),
    coalesce(trim(p_summary), ''), coalesce(trim(p_about), ''),
    p_price_paise, 0, 0, false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_activity(text, text, text, text, int, text) from public;
grant execute on function add_partner_activity(text, text, text, text, int, text) to authenticated;

create or replace function add_partner_vehicle(
  p_type text,
  p_model text,
  p_rate_paise int,
  p_seats int,
  p_meta text,
  p_units int,
  p_photo_path text default null
) returns table (ok boolean, message text, vehicle_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_code text;
  v_seats int;
  v_units int;
  v_exists boolean;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_type not in ('scooter', 'bike', 'bicycle') then
    return query select false, 'Choose a valid vehicle type.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the vehicle a model name.'::text, null::uuid;
    return;
  end if;
  if p_rate_paise is null or p_rate_paise < 0 then
    return query select false, 'Enter a valid rate.'::text, null::uuid;
    return;
  end if;

  v_seats := greatest(coalesce(p_seats, 2), 1);
  v_units := greatest(coalesce(p_units, 1), 1);

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_model), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    select exists(select 1 from vehicles where partner_id = v_partner and code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into vehicles (code, partner_id, type, model, rate_paise, seats, meta, units, is_listed, photo_path)
  values (v_code, v_partner, p_type, trim(p_model), p_rate_paise, v_seats, coalesce(trim(p_meta), ''), v_units, false, p_photo_path)
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_vehicle(text, text, int, int, text, int, text) from public;
grant execute on function add_partner_vehicle(text, text, int, int, text, int, text) to authenticated;

create or replace function add_partner_stay(
  p_type text,
  p_name text,
  p_area text,
  p_price_paise int,
  p_blurb text,
  p_about text,
  p_amenities text[] default '{}',
  p_photo_path text default null
) returns table (ok boolean, message text, stay_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_mark text;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_type not in ('hotel', 'homestay', 'resort') then
    return query select false, 'Choose a valid stay type.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the room or stay a name.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'stays');

  insert into stays (
    slug, partner_id, island_slug, type, mark, name, area, distance_label,
    price_paise, rating, reviews, blurb, about, amenities, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_type, v_mark, trim(p_name),
    coalesce(nullif(trim(p_area), ''), 'Near the property'), '',
    p_price_paise, 0, 0, coalesce(trim(p_blurb), ''), coalesce(trim(p_about), ''),
    coalesce(p_amenities, '{}'), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_stay(text, text, text, int, text, text, text[], text) from public;
grant execute on function add_partner_stay(text, text, text, int, text, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: partner-uploaded photos (public bucket — travellers see these
-- once approved) and license documents (private — Arun reviews them, no
-- traveller ever sees this bucket). Both scoped so a partner can only touch
-- their own folder, named after their partner_id.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('partner-photos', 'partner-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('partner-licenses', 'partner-licenses', false)
on conflict (id) do nothing;

create policy "partners manage own photos" on storage.objects
  for all
  using (
    bucket_id = 'partner-photos'
    and (storage.foldername(name))[1] = (select partner_id::text from partner_users where user_id = auth.uid())
  )
  with check (
    bucket_id = 'partner-photos'
    and (storage.foldername(name))[1] = (select partner_id::text from partner_users where user_id = auth.uid())
  );

create policy "partners manage own license docs" on storage.objects
  for all
  using (
    bucket_id = 'partner-licenses'
    and (storage.foldername(name))[1] = (select partner_id::text from partner_users where user_id = auth.uid())
  )
  with check (
    bucket_id = 'partner-licenses'
    and (storage.foldername(name))[1] = (select partner_id::text from partner_users where user_id = auth.uid())
  );
