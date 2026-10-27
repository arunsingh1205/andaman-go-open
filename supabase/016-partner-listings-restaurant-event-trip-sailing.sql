-- Round 3: partners can add and edit restaurants, events, trips, and
-- sailings themselves — the same self-serve flow 011 gave activities,
-- vehicles, and stays, and the same edit flow 013 gave those three.
--
-- All four tables already exist in schema.sql (travellers could already
-- book them, seeded by hand) — this migration is additive: new columns,
-- new RLS policies, and new RPCs. Nothing here touches existing rows beyond
-- giving them photo_path = null / rejection_reason = null, which is exactly
-- the "never looked at yet" state 012 already uses for the other three
-- kinds.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- New partner-facing columns, same as 011/012 added for activities,
-- vehicles, and stays.
-- ---------------------------------------------------------------------------

alter table restaurants add column if not exists photo_path text;
alter table events      add column if not exists photo_path text;
alter table trips       add column if not exists photo_path text;
alter table sailings    add column if not exists photo_path text;

alter table restaurants add column if not exists rejection_reason text;
alter table events      add column if not exists rejection_reason text;
alter table trips       add column if not exists rejection_reason text;
alter table sailings    add column if not exists rejection_reason text;

-- ---------------------------------------------------------------------------
-- A partner needs to see their own pending work, same as 011 gave
-- activities/vehicles/stays. Restaurants/events/trips/sailings never got
-- this because until now nothing but Arun's seed data ever wrote to them.
-- ---------------------------------------------------------------------------

create policy "partner sees own restaurants" on restaurants
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = restaurants.partner_id)
  );

create policy "partner sees own events" on events
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = events.partner_id)
  );

create policy "partner sees own trips" on trips
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = trips.partner_id)
  );

create policy "partner sees own sailings" on sailings
  for select using (
    exists (select 1 from partner_users pu where pu.user_id = auth.uid() and pu.partner_id = sailings.partner_id)
  );

-- Admins need to see every one of these too, same as 012 gave
-- activities/vehicles/stays.

create policy "admins see all restaurants" on restaurants
  for select using (is_admin());

create policy "admins see all events" on events
  for select using (is_admin());

create policy "admins see all trips" on trips
  for select using (is_admin());

create policy "admins see all sailings" on sailings
  for select using (is_admin());

-- ---------------------------------------------------------------------------
-- add_partner_restaurant — same shape as add_partner_activity/add_partner_stay.
-- ---------------------------------------------------------------------------

create or replace function add_partner_restaurant(
  p_category text,
  p_name text,
  p_area text,
  p_price_tier int,
  p_blurb text,
  p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text, restaurant_id uuid)
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

  if p_category not in ('seafood', 'indian', 'continental', 'cafe') then
    return query select false, 'Choose a valid cuisine.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the restaurant a name.'::text, null::uuid;
    return;
  end if;
  if p_price_tier is null or p_price_tier not between 1 and 3 then
    return query select false, 'Choose a valid price range.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'restaurants');

  insert into restaurants (
    slug, partner_id, island_slug, category, mark, name, area, distance_label,
    price_tier, rating, reviews, blurb, about, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_category, v_mark, trim(p_name),
    coalesce(nullif(trim(p_area), ''), 'Near the property'), '',
    p_price_tier, 0, 0, coalesce(trim(p_blurb), ''), coalesce(trim(p_about), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_restaurant(text, text, text, int, text, text, text) from public;
grant execute on function add_partner_restaurant(text, text, text, int, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_partner_event
-- ---------------------------------------------------------------------------

create or replace function add_partner_event(
  p_genre text,
  p_name text,
  p_venue text,
  p_area text,
  p_on_date date,
  p_time_mins int,
  p_entry_paise int,
  p_capacity int,
  p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text, event_id uuid)
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

  if p_genre not in ('dj', 'live', 'bonfire', 'karaoke') then
    return query select false, 'Choose a valid event type.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the event a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_venue), '') = '' then
    return query select false, 'Give the event a venue.'::text, null::uuid;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text, null::uuid;
    return;
  end if;
  if p_entry_paise is null or p_entry_paise < 0 then
    return query select false, 'Enter a valid entry price.'::text, null::uuid;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, entry_paise, capacity, rating, reviews, about, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_event(text, text, text, text, date, int, int, int, text, text) from public;
grant execute on function add_partner_event(text, text, text, text, date, int, int, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_partner_trip
-- ---------------------------------------------------------------------------

create or replace function add_partner_trip(
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_deposit_paise int,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null
) returns table (ok boolean, message text, trip_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the host a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;
  if p_deposit_paise is null or p_deposit_paise < 0 or p_deposit_paise > p_price_paise then
    return query select false, 'Enter a valid deposit.'::text, null::uuid;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text, null::uuid;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Enter a valid minimum seat count.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_slug := unique_slug(p_title, 'trips');

  insert into trips (
    slug, partner_id, island_slug, title, host_name, host_since, duration_label,
    runs_on_days, price_paise, deposit_paise, min_seats, seats_total, rating, reviews,
    summary, includes, meet_point, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_deposit_paise, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), trim(p_meet_point), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_trip(text, text, text, text, int[], int, int, int, int, text, text[], text, text) from public;
grant execute on function add_partner_trip(text, text, text, text, int[], int, int, int, int, text, text[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_partner_sailing — the odd one out: sailings.code is globally unique
-- (not scoped to a partner, unlike vehicles.code), because it doubles as a
-- stable URL slug across every operator. The generation loop below checks
-- the whole table rather than one partner's rows.
-- ---------------------------------------------------------------------------

create or replace function add_partner_sailing(
  p_from_island text,
  p_to_island text,
  p_style_label text,
  p_dep_mins int,
  p_duration_mins int,
  p_fare_paise int,
  p_capacity int,
  p_days_of_week int[],
  p_style_tone text default 'plain',
  p_info text default '',
  p_info_warn boolean default false,
  p_photo_path text default null
) returns table (ok boolean, message text, sailing_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_from_island = p_to_island then
    return query select false, 'Departure and arrival islands must be different.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_from_island) then
    return query select false, 'Choose a valid departure island.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_to_island) then
    return query select false, 'Choose a valid arrival island.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_style_label), '') = '' then
    return query select false, 'Give the ticket class a name.'::text, null::uuid;
    return;
  end if;
  if p_fare_paise is null or p_fare_paise < 0 then
    return query select false, 'Enter a valid fare.'::text, null::uuid;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text, null::uuid;
    return;
  end if;
  if p_duration_mins is null or p_duration_mins < 1 then
    return query select false, 'Enter a valid journey time.'::text, null::uuid;
    return;
  end if;
  if p_days_of_week is null or array_length(p_days_of_week, 1) is null then
    return query select false, 'Choose at least one day it runs.'::text, null::uuid;
    return;
  end if;
  if p_style_tone not in ('good', 'warm', 'plain') then
    return query select false, 'Choose a valid badge style.'::text, null::uuid;
    return;
  end if;

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_style_label), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    select exists(select 1 from sailings where code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into sailings (
    code, partner_id, from_island, to_island, style_label, dep_mins, duration_mins,
    fare_paise, capacity, days_of_week, style_tone, info, info_warn, is_listed, photo_path
  ) values (
    v_code, v_partner, p_from_island, p_to_island, trim(p_style_label), p_dep_mins, p_duration_mins,
    p_fare_paise, p_capacity, p_days_of_week, p_style_tone, coalesce(trim(p_info), ''), coalesce(p_info_warn, false),
    false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_sailing(text, text, text, int, int, int, int, int[], text, text, boolean, text) from public;
grant execute on function add_partner_sailing(text, text, text, int, int, int, int, int[], text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_partner_restaurant / update_partner_event / update_partner_trip /
-- update_partner_sailing — same discipline as 013: ownership check, editing
-- a LIVE listing sends it back to pending, editing a pending/rejected one
-- saves in place. Category/type/route stay fixed, same reasoning 013 gave
-- for the first three kinds.
-- ---------------------------------------------------------------------------

create or replace function update_partner_restaurant(
  p_id uuid,
  p_name text,
  p_area text,
  p_price_tier int,
  p_blurb text,
  p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the restaurant a name.'::text;
    return;
  end if;
  if p_price_tier is null or p_price_tier not between 1 and 3 then
    return query select false, 'Choose a valid price range.'::text;
    return;
  end if;

  select is_listed into v_was_listed from restaurants where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update restaurants set
    name = trim(p_name),
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    price_tier = p_price_tier,
    blurb = coalesce(trim(p_blurb), ''),
    about = coalesce(trim(p_about), ''),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_restaurant(uuid, text, text, int, text, text, text) from public;
grant execute on function update_partner_restaurant(uuid, text, text, int, text, text, text) to authenticated;

create or replace function update_partner_event(
  p_id uuid,
  p_name text,
  p_venue text,
  p_area text,
  p_on_date date,
  p_time_mins int,
  p_entry_paise int,
  p_capacity int,
  p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the event a name.'::text;
    return;
  end if;
  if coalesce(trim(p_venue), '') = '' then
    return query select false, 'Give the event a venue.'::text;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text;
    return;
  end if;
  if p_entry_paise is null or p_entry_paise < 0 then
    return query select false, 'Enter a valid entry price.'::text;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text;
    return;
  end if;

  select is_listed into v_was_listed from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    on_date = p_on_date,
    time_mins = p_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_event(uuid, text, text, text, date, int, int, int, text, text) from public;
grant execute on function update_partner_event(uuid, text, text, text, date, int, int, int, text, text) to authenticated;

create or replace function update_partner_trip(
  p_id uuid,
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_deposit_paise int,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the host a name.'::text;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;
  if p_deposit_paise is null or p_deposit_paise < 0 or p_deposit_paise > p_price_paise then
    return query select false, 'Enter a valid deposit.'::text;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Enter a valid minimum seat count.'::text;
    return;
  end if;

  select is_listed into v_was_listed from trips where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update trips set
    title = trim(p_title),
    host_name = trim(p_host_name),
    host_since = coalesce(trim(p_host_since), ''),
    duration_label = coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    runs_on_days = coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'),
    price_paise = p_price_paise,
    deposit_paise = p_deposit_paise,
    min_seats = p_min_seats,
    seats_total = p_seats_total,
    summary = coalesce(trim(p_summary), ''),
    includes = coalesce(p_includes, '{}'),
    meet_point = trim(p_meet_point),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_trip(uuid, text, text, text, text, int[], int, int, int, int, text, text[], text, text) from public;
grant execute on function update_partner_trip(uuid, text, text, text, text, int[], int, int, int, int, text, text[], text, text) to authenticated;

-- Route (from/to island) isn't editable here — changing it would mean
-- regenerating the code, and a partner who wants a different route can add
-- a fresh sailing instead, same as category/type on the other three kinds.
create or replace function update_partner_sailing(
  p_id uuid,
  p_style_label text,
  p_dep_mins int,
  p_duration_mins int,
  p_fare_paise int,
  p_capacity int,
  p_days_of_week int[],
  p_style_tone text default 'plain',
  p_info text default '',
  p_info_warn boolean default false,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_style_label), '') = '' then
    return query select false, 'Give the ticket class a name.'::text;
    return;
  end if;
  if p_fare_paise is null or p_fare_paise < 0 then
    return query select false, 'Enter a valid fare.'::text;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text;
    return;
  end if;
  if p_duration_mins is null or p_duration_mins < 1 then
    return query select false, 'Enter a valid journey time.'::text;
    return;
  end if;
  if p_days_of_week is null or array_length(p_days_of_week, 1) is null then
    return query select false, 'Choose at least one day it runs.'::text;
    return;
  end if;
  if p_style_tone not in ('good', 'warm', 'plain') then
    return query select false, 'Choose a valid badge style.'::text;
    return;
  end if;

  select is_listed into v_was_listed from sailings where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update sailings set
    style_label = trim(p_style_label),
    dep_mins = p_dep_mins,
    duration_mins = p_duration_mins,
    fare_paise = p_fare_paise,
    capacity = p_capacity,
    days_of_week = p_days_of_week,
    style_tone = p_style_tone,
    info = coalesce(trim(p_info), ''),
    info_warn = coalesce(p_info_warn, false),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_sailing(uuid, text, int, int, int, int, int[], text, text, boolean, text) from public;
grant execute on function update_partner_sailing(uuid, text, int, int, int, int, int[], text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Extending the three admin/resubmit RPCs from 012 to the four new kinds.
-- create or replace keeps the same signature, so nothing that already calls
-- these needs to change — the "unknown listing type" branch is now only hit
-- by a genuinely bad kind, not one that just hadn't been wired up yet.
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

  if p_kind = 'activity' then
    update activities set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = true, rejection_reason = null where id = p_id;
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
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Approved.'::text;
end;
$$;

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
  elsif p_kind = 'stay' then
    update stays set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
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
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Rejected.'::text;
end;
$$;

create or replace function resubmit_partner_listing(p_kind text, p_id uuid)
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
  elsif p_kind = 'stay' then
    update stays set rejection_reason = null
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
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'Nothing to resubmit.'::text;
    return;
  end if;

  return query select true, 'Sent back for review.'::text;
end;
$$;
