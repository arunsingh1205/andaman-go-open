-- ===========================================================================
-- Migration 092 — an optional, approximate end time for events, trips and
-- community service
--
-- These three are single dated/timed listings, not something a traveller
-- picks a time within — so unlike activities/restaurants (090/091) they get
-- no window/expansion logic, just a second, purely descriptive time next to
-- the existing start time ("7 PM – 9 PM (approx)"). No "must be after start"
-- check: an overnight event with an approximate end (10 PM start, 2 AM end)
-- is a legitimate case a same-day ordering constraint would wrongly reject.
--
-- Bundled into the same migration: events.capacity and trips.seats_total
-- become properly optional inside these RPCs (089 already relaxed the
-- column constraints; this teaches add/update_partner_event,
-- admin_update_event, add/update_partner_trip and admin_update_trip to
-- accept a blank capacity/seat-count as "uncapped") — bundled rather than a
-- separate migration since it touches the exact same function bodies as the
-- end-time addition. Community service never had a capacity column, so no
-- equivalent change is needed there.
--
-- Every touched RPC gains one new trailing default parameter, which changes
-- its argument-type signature — following this codebase's existing
-- convention (071, 076), each is explicitly DROPPED at its old signature
-- before being recreated, so the old overload doesn't linger.
--
-- Safe to run more than once.
-- ===========================================================================

alter table events add column if not exists end_time_mins int;
alter table events drop constraint if exists events_end_time_mins_check;
alter table events add constraint events_end_time_mins_check
  check (end_time_mins is null or end_time_mins between 0 and 1439);

alter table trips add column if not exists ends_mins int;
alter table trips drop constraint if exists trips_ends_mins_check;
alter table trips add constraint trips_ends_mins_check
  check (ends_mins is null or ends_mins between 0 and 1439);

alter table community_services add column if not exists end_time_mins int;
alter table community_services drop constraint if exists community_services_end_time_mins_check;
alter table community_services add constraint community_services_end_time_mins_check
  check (end_time_mins is null or end_time_mins between 0 and 1439);


-- ---------------------------------------------------------------------------
-- add_partner_event / update_partner_event (071) — + p_end_time_mins,
-- capacity now optional.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text, text, text);

create or replace function add_partner_event(
  p_genre           text,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null,
  p_end_time_mins   int  default null
) returns table (ok boolean, message text, event_id uuid)
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

  if p_genre not in ('dj', 'live', 'bonfire', 'karaoke', 'comedy', 'drama', 'festival', 'carnival', 'cruise') then
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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text, null::uuid;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text, null::uuid;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text, null::uuid;
    return;
  end if;
  if p_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text, null::uuid;
    return;
  end if;

  -- Island: the form's choice wins; a blank falls back to the partner's own.
  select island_slug into v_island from partners where id = v_partner;
  if coalesce(trim(p_island_slug), '') <> '' then
    if not exists (select 1 from islands where slug = p_island_slug) then
      return query select false, 'Choose a valid island.'::text, null::uuid;
      return;
    end if;
    v_island := trim(p_island_slug);
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, end_time_mins, entry_paise, capacity, rating, reviews, about,
    age_restriction, performer, maps_url, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_end_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''),
    p_age_restriction, nullif(trim(p_performer), ''), nullif(trim(p_maps_url), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text, text, text, int) from public;
grant execute on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text, text, text, int)
  to authenticated;


drop function if exists update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, text);

create or replace function update_partner_event(
  p_id              uuid,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null,
  p_end_time_mins   int  default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
  v_genre      text;
begin
  perform assert_partner_owner();

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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  select is_listed, genre into v_was_listed, v_genre
  from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), ''),
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

revoke all on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, text, int) from public;
grant execute on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, text, int)
  to authenticated;


drop function if exists admin_update_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text);

create or replace function admin_update_event(
  p_id uuid, p_name text, p_venue text, p_area text, p_on_date date,
  p_time_mins int, p_entry_paise int, p_capacity int, p_about text,
  p_age_restriction text, p_performer text, p_island_slug text, p_maps_url text,
  p_end_time_mins int default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_genre text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  select genre into v_genre from events where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), '')
  where id = p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, int) from public;
grant execute on function admin_update_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- add_partner_trip / update_partner_trip / admin_update_trip (074/076/075) —
-- + p_ends_mins, seats_total now optional.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_trip(
  text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text);

create or replace function add_partner_trip(
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_difficulty text,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_bring_list text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null,
  p_departs_mins int default 360,
  p_run_dates date[] default '{}',
  p_meet_at_hotel boolean default false,
  p_maps_url text default null,
  p_ends_mins int default null
) returns table (ok boolean, message text, trip_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_id uuid;
begin
  perform assert_partner_owner();

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
  if not coalesce(p_meet_at_hotel, false) and coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;
  if p_difficulty not in ('easy', 'moderate', 'challenging') then
    return query select false, 'Choose a valid difficulty.'::text, null::uuid;
    return;
  end if;
  if p_seats_total is not null and p_seats_total < 1 then
    return query select false, 'Seat count has to be greater than zero, or left blank for no limit.'::text, null::uuid;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1
     or (p_seats_total is not null and p_min_seats > p_seats_total) then
    return query select false, 'Enter a valid minimum seat count.'::text, null::uuid;
    return;
  end if;
  if p_departs_mins is null or p_departs_mins < 0 or p_departs_mins >= 1440 then
    return query select false, 'Choose a valid pickup time.'::text, null::uuid;
    return;
  end if;
  if p_ends_mins is not null and p_ends_mins not between 0 and 1439 then
    return query select false, 'Enter a valid return time.'::text, null::uuid;
    return;
  end if;
  if array_length(p_run_dates, 1) is not null
     and exists (select 1 from unnest(p_run_dates) d where d < current_date) then
    return query select false, 'Pick dates in the future.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_slug := unique_slug(p_title, 'trips');

  insert into trips (
    slug, partner_id, island_slug, title, host_name, host_since, duration_label,
    runs_on_days, price_paise, difficulty, min_seats, seats_total, rating, reviews,
    summary, includes, bring_list, meet_point, is_listed, photo_path,
    departs_mins, run_dates, meet_at_hotel, maps_url, ends_mins
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_difficulty, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), coalesce(p_bring_list, '{}'),
    case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    false, p_photo_path,
    p_departs_mins, coalesce(p_run_dates, '{}'), coalesce(p_meet_at_hotel, false),
    nullif(trim(p_maps_url), ''), p_ends_mins
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_trip(
  text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text, int) from public;
grant execute on function add_partner_trip(
  text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text, int)
  to authenticated;


drop function if exists update_partner_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text);

create or replace function update_partner_trip(
  p_id uuid,
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_difficulty text,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_bring_list text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null,
  p_departs_mins int default 360,
  p_run_dates date[] default '{}',
  p_meet_at_hotel boolean default false,
  p_maps_url text default null,
  p_ends_mins int default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

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
  if not coalesce(p_meet_at_hotel, false) and coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;
  if p_difficulty not in ('easy', 'moderate', 'challenging') then
    return query select false, 'Choose a valid difficulty.'::text;
    return;
  end if;
  if p_seats_total is not null and p_seats_total < 1 then
    return query select false, 'Seat count has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1
     or (p_seats_total is not null and p_min_seats > p_seats_total) then
    return query select false, 'Enter a valid minimum seat count.'::text;
    return;
  end if;
  if p_departs_mins is null or p_departs_mins < 0 or p_departs_mins >= 1440 then
    return query select false, 'Choose a valid pickup time.'::text;
    return;
  end if;
  if p_ends_mins is not null and p_ends_mins not between 0 and 1439 then
    return query select false, 'Enter a valid return time.'::text;
    return;
  end if;
  if array_length(p_run_dates, 1) is not null
     and exists (select 1 from unnest(p_run_dates) d where d < current_date) then
    return query select false, 'Pick dates in the future.'::text;
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
    difficulty = p_difficulty,
    min_seats = p_min_seats,
    seats_total = p_seats_total,
    summary = coalesce(trim(p_summary), ''),
    includes = coalesce(p_includes, '{}'),
    bring_list = coalesce(p_bring_list, '{}'),
    meet_point = case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    meet_at_hotel = coalesce(p_meet_at_hotel, false),
    maps_url = nullif(trim(p_maps_url), ''),
    photo_path = p_photo_path,
    departs_mins = p_departs_mins,
    run_dates = coalesce(p_run_dates, '{}'),
    ends_mins = p_ends_mins,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text, int) from public;
grant execute on function update_partner_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text, int)
  to authenticated;


drop function if exists admin_update_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean, text);

create or replace function admin_update_trip(
  p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text,
  p_runs_on_days int[], p_price_paise int, p_difficulty text, p_min_seats int,
  p_seats_total int, p_summary text, p_includes text[], p_bring_list text[],
  p_meet_point text, p_departs_mins int, p_run_dates date[],
  p_meet_at_hotel boolean default false, p_maps_url text default null,
  p_ends_mins int default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the host a name.'::text;
    return;
  end if;
  if not coalesce(p_meet_at_hotel, false) and coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;
  if p_difficulty not in ('easy', 'moderate', 'challenging') then
    return query select false, 'Choose a valid difficulty.'::text;
    return;
  end if;
  if p_seats_total is not null and p_seats_total < 1 then
    return query select false, 'Seat count has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1
     or (p_seats_total is not null and p_min_seats > p_seats_total) then
    return query select false, 'Enter a valid minimum seat count.'::text;
    return;
  end if;
  if p_departs_mins is null or p_departs_mins < 0 or p_departs_mins >= 1440 then
    return query select false, 'Choose a valid pickup time.'::text;
    return;
  end if;
  if p_ends_mins is not null and p_ends_mins not between 0 and 1439 then
    return query select false, 'Enter a valid return time.'::text;
    return;
  end if;
  if array_length(p_run_dates, 1) is not null
     and exists (select 1 from unnest(p_run_dates) d where d < current_date) then
    return query select false, 'Pick dates in the future.'::text;
    return;
  end if;

  update trips set
    title = trim(p_title),
    host_name = trim(p_host_name),
    host_since = coalesce(trim(p_host_since), ''),
    duration_label = coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    runs_on_days = coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'),
    price_paise = p_price_paise,
    difficulty = p_difficulty,
    min_seats = p_min_seats,
    seats_total = p_seats_total,
    summary = coalesce(trim(p_summary), ''),
    includes = coalesce(p_includes, '{}'),
    bring_list = coalesce(p_bring_list, '{}'),
    meet_point = case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    meet_at_hotel = coalesce(p_meet_at_hotel, false),
    maps_url = nullif(trim(p_maps_url), ''),
    departs_mins = p_departs_mins,
    run_dates = coalesce(p_run_dates, '{}'),
    ends_mins = p_ends_mins
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean, text, int) from public;
grant execute on function admin_update_trip(
  uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- add_partner_community_service / update_partner_community_service /
-- admin_update_community_service (072/075) — + p_end_time_mins.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_community_service(
  text, text, text, date, int, text, text, text, text, text, int, int, text, text, text);

create or replace function add_partner_community_service(
  p_name               text,
  p_organizer_name     text,
  p_about              text,
  p_on_date            date,
  p_time_mins          int,
  p_island_slug        text default null,
  p_maps_url           text default null,
  p_meeting_point      text default '',
  p_what_to_bring      text default null,
  p_safety_notes       text default null,
  p_min_age            int  default null,
  p_max_age            int  default null,
  p_contact_name       text default '',
  p_contact_phone      text default '',
  p_whatsapp_group_url text default null,
  p_end_time_mins      int  default null
) returns table (ok boolean, message text, community_service_id uuid)
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

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_organizer_name), '') = '' then
    return query select false, 'Add the organiser or NGO name.'::text, null::uuid;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text, null::uuid;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a start time.'::text, null::uuid;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_meeting_point), '') = '' then
    return query select false, 'Add a meeting point.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    return query select false, 'Add a primary contact — a name and a phone number.'::text, null::uuid;
    return;
  end if;
  if p_min_age is not null and p_min_age not between 0 and 120 then
    return query select false, 'Enter a valid minimum age.'::text, null::uuid;
    return;
  end if;
  if p_max_age is not null and p_max_age not between 0 and 120 then
    return query select false, 'Enter a valid maximum age.'::text, null::uuid;
    return;
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then
    return query select false, 'The maximum age can''t be below the minimum.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  if coalesce(trim(p_island_slug), '') <> '' then
    if not exists (select 1 from islands where slug = p_island_slug) then
      return query select false, 'Choose a valid island.'::text, null::uuid;
      return;
    end if;
    v_island := trim(p_island_slug);
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'community_services');

  insert into community_services (
    slug, partner_id, island_slug, mark, name, organizer_name, about,
    on_date, time_mins, end_time_mins, maps_url, meeting_point, what_to_bring, safety_notes,
    min_age, max_age, contact_name, contact_phone, whatsapp_group_url, is_listed
  ) values (
    v_slug, v_partner, v_island, v_mark, trim(p_name), trim(p_organizer_name),
    coalesce(trim(p_about), ''), p_on_date, p_time_mins, p_end_time_mins,
    nullif(trim(p_maps_url), ''), trim(p_meeting_point),
    nullif(trim(p_what_to_bring), ''), nullif(trim(p_safety_notes), ''),
    p_min_age, p_max_age, trim(p_contact_name), trim(p_contact_phone),
    nullif(trim(p_whatsapp_group_url), ''), false
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_community_service(
  text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) from public;
grant execute on function add_partner_community_service(
  text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) to authenticated;


drop function if exists update_partner_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text);

create or replace function update_partner_community_service(
  p_id                 uuid,
  p_name               text,
  p_organizer_name     text,
  p_about              text,
  p_on_date            date,
  p_time_mins          int,
  p_island_slug        text default null,
  p_maps_url           text default null,
  p_meeting_point      text default '',
  p_what_to_bring      text default null,
  p_safety_notes       text default null,
  p_min_age            int  default null,
  p_max_age            int  default null,
  p_contact_name       text default '',
  p_contact_phone      text default '',
  p_whatsapp_group_url text default null,
  p_end_time_mins      int  default null
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
    return query select false, 'Give the activity a name.'::text;
    return;
  end if;
  if coalesce(trim(p_organizer_name), '') = '' then
    return query select false, 'Add the organiser or NGO name.'::text;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a start time.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if coalesce(trim(p_meeting_point), '') = '' then
    return query select false, 'Add a meeting point.'::text;
    return;
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    return query select false, 'Add a primary contact — a name and a phone number.'::text;
    return;
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then
    return query select false, 'The maximum age can''t be below the minimum.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  select is_listed into v_was_listed
  from community_services where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update community_services set
    name = trim(p_name),
    organizer_name = trim(p_organizer_name),
    about = coalesce(trim(p_about), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    meeting_point = trim(p_meeting_point),
    what_to_bring = nullif(trim(p_what_to_bring), ''),
    safety_notes = nullif(trim(p_safety_notes), ''),
    min_age = p_min_age,
    max_age = p_max_age,
    contact_name = trim(p_contact_name),
    contact_phone = trim(p_contact_phone),
    whatsapp_group_url = nullif(trim(p_whatsapp_group_url), ''),
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) from public;
grant execute on function update_partner_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) to authenticated;


drop function if exists admin_update_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text);

create or replace function admin_update_community_service(
  p_id uuid, p_name text, p_organizer_name text, p_about text, p_on_date date, p_time_mins int,
  p_island_slug text, p_maps_url text, p_meeting_point text, p_what_to_bring text,
  p_safety_notes text, p_min_age int, p_max_age int, p_contact_name text,
  p_contact_phone text, p_whatsapp_group_url text,
  p_end_time_mins int default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text;
    return;
  end if;
  if coalesce(trim(p_organizer_name), '') = '' then
    return query select false, 'Add the organiser or NGO name.'::text;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a start time.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if coalesce(trim(p_meeting_point), '') = '' then
    return query select false, 'Add a meeting point.'::text;
    return;
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    return query select false, 'Add a primary contact — a name and a phone number.'::text;
    return;
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then
    return query select false, 'The maximum age can''t be below the minimum.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  update community_services set
    name = trim(p_name),
    organizer_name = trim(p_organizer_name),
    about = coalesce(trim(p_about), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    meeting_point = trim(p_meeting_point),
    what_to_bring = nullif(trim(p_what_to_bring), ''),
    safety_notes = nullif(trim(p_safety_notes), ''),
    min_age = p_min_age,
    max_age = p_max_age,
    contact_name = trim(p_contact_name),
    contact_phone = trim(p_contact_phone),
    whatsapp_group_url = nullif(trim(p_whatsapp_group_url), '')
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) from public;
grant execute on function admin_update_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text, int
) to authenticated;


select 'approximate end time installed for events, trips and community service' as done;
