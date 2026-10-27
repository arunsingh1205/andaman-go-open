-- ===========================================================================
-- Migration 075 — an admin can edit a partner's listings and profile
--
-- Until now the admin console could only APPROVE / REJECT / TAKE DOWN a
-- listing (012 / 018 / 049). Everything a listing actually says — its name,
-- price, description, capacity, schedule, per-listing address, photos — and
-- everything on the business profile could only be changed by the partner.
-- When a partner submits something wrong, "send it back with a reason" and
-- wait was the only lever, which strains the relationship and delays go-live.
--
-- This adds a parallel set of admin_* write RPCs — same convention as
-- admin_approve_listing / admin_unlist_listing / admin_remove_review /
-- admin_partner_team. Each is SECURITY DEFINER, gated on is_admin(), takes the
-- target id explicitly (no partner_id derived from auth.uid()), and mirrors
-- the field validation of its update_partner_* twin.
--
-- One deliberate difference from the partner path: an admin edit to a LIVE
-- listing does NOT flip it back to pending. The admin is trusted and is
-- fixing the listing on the partner's behalf; bouncing it offline would
-- defeat the purpose. So these never touch is_listed / rejection_reason.
--
-- Reads still go through the plain scoped selects in lib/partner-register.ts /
-- lib/partner-cabs.ts — the "admins see all X" SELECT policies (012/016/033/037)
-- already let an admin read any catalogue row.
--
-- Safe to run more than once.
-- ===========================================================================


-- ===========================================================================
-- 1. Listing content — one RPC per kind, mirroring update_partner_<kind>.
-- ===========================================================================

create or replace function admin_update_activity(
  p_id uuid, p_name text, p_summary text, p_about text, p_price_paise int
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;

  update activities set
    name = trim(p_name),
    summary = coalesce(trim(p_summary), ''),
    about = coalesce(trim(p_about), ''),
    price_paise = p_price_paise
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_activity(uuid, text, text, text, int) from public;
grant execute on function admin_update_activity(uuid, text, text, text, int) to authenticated;


create or replace function admin_update_vehicle(
  p_id uuid, p_model text, p_rate_paise int, p_seats int, p_meta text, p_units int
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the vehicle a model name.'::text;
    return;
  end if;
  if p_rate_paise is null or p_rate_paise < 0 then
    return query select false, 'Enter a valid rate.'::text;
    return;
  end if;

  update vehicles set
    model = trim(p_model),
    rate_paise = p_rate_paise,
    seats = greatest(coalesce(p_seats, 2), 1),
    meta = coalesce(trim(p_meta), ''),
    units = greatest(coalesce(p_units, 1), 1)
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_vehicle(uuid, text, int, int, text, int) from public;
grant execute on function admin_update_vehicle(uuid, text, int, int, text, int) to authenticated;


create or replace function admin_set_vehicle_security_deposit(p_vehicle_id uuid, p_paise int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_paise is null or p_paise < 0 then
    return query select false, 'The deposit has to be zero or more.'::text;
    return;
  end if;

  update vehicles set security_deposit_paise = p_paise where id = p_vehicle_id;
  if not found then
    return query select false, 'That vehicle no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_vehicle_security_deposit(uuid, int) from public;
grant execute on function admin_set_vehicle_security_deposit(uuid, int) to authenticated;


create or replace function admin_update_cab(
  p_id uuid, p_category text, p_model text, p_seats int, p_luggage int, p_ac boolean,
  p_fuel text, p_board_number text, p_full_day_paise int,
  p_airport_surcharge_paise int, p_night_surcharge_paise int,
  p_per_km_paise int, p_per_min_paise int, p_meta text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid car type.'::text;
    return;
  end if;
  if p_fuel not in ('ev','petrol','diesel') then
    return query select false, 'Choose petrol, diesel or electric.'::text;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the car a model name.'::text;
    return;
  end if;
  if p_full_day_paise is null or p_full_day_paise < 0 then
    return query select false, 'Enter a valid full-day fare.'::text;
    return;
  end if;

  update cabs set
    category = p_category,
    model = trim(p_model),
    seats = greatest(coalesce(p_seats, 4), 1),
    luggage = greatest(coalesce(p_luggage, 0), 0),
    ac = coalesce(p_ac, true),
    fuel = p_fuel,
    board_number = nullif(trim(p_board_number), ''),
    full_day_paise = p_full_day_paise,
    airport_surcharge_paise = greatest(coalesce(p_airport_surcharge_paise, 0), 0),
    night_surcharge_paise = greatest(coalesce(p_night_surcharge_paise, 0), 0),
    per_km_paise = greatest(coalesce(p_per_km_paise, 0), 0),
    per_min_paise = greatest(coalesce(p_per_min_paise, 0), 0),
    meta = coalesce(trim(p_meta), '')
  where id = p_id;
  if not found then
    return query select false, 'That car no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_cab(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text) from public;
grant execute on function admin_update_cab(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text) to authenticated;


create or replace function admin_update_restaurant(
  p_id uuid, p_name text, p_area text, p_price_tier int, p_blurb text, p_about text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the restaurant a name.'::text;
    return;
  end if;
  if p_price_tier is null or p_price_tier not between 1 and 3 then
    return query select false, 'Choose a valid price range.'::text;
    return;
  end if;

  update restaurants set
    name = trim(p_name),
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    price_tier = p_price_tier,
    blurb = coalesce(trim(p_blurb), ''),
    about = coalesce(trim(p_about), '')
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_restaurant(uuid, text, text, int, text, text) from public;
grant execute on function admin_update_restaurant(uuid, text, text, int, text, text) to authenticated;


create or replace function admin_update_event(
  p_id uuid, p_name text, p_venue text, p_area text, p_on_date date,
  p_time_mins int, p_entry_paise int, p_capacity int, p_about text,
  p_age_restriction text, p_performer text, p_island_slug text, p_maps_url text
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
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text;
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
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), '')
  where id = p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text) from public;
grant execute on function admin_update_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text) to authenticated;


create or replace function admin_update_trip(
  p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text,
  p_runs_on_days int[], p_price_paise int, p_difficulty text, p_min_seats int,
  p_seats_total int, p_summary text, p_includes text[], p_bring_list text[],
  p_meet_point text, p_departs_mins int, p_run_dates date[]
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
  if coalesce(trim(p_meet_point), '') = '' then
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
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Enter a valid minimum seat count.'::text;
    return;
  end if;
  if p_departs_mins is null or p_departs_mins < 0 or p_departs_mins >= 1440 then
    return query select false, 'Choose a valid pickup time.'::text;
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
    meet_point = trim(p_meet_point),
    departs_mins = p_departs_mins,
    run_dates = coalesce(p_run_dates, '{}')
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[]) from public;
grant execute on function admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[]) to authenticated;


create or replace function admin_update_sailing(
  p_id uuid, p_style_label text, p_dep_mins int, p_duration_mins int, p_fare_paise int,
  p_capacity int, p_days_of_week int[], p_style_tone text, p_info text, p_info_warn boolean
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

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

  update sailings set
    style_label = trim(p_style_label),
    dep_mins = p_dep_mins,
    duration_mins = p_duration_mins,
    fare_paise = p_fare_paise,
    capacity = p_capacity,
    days_of_week = p_days_of_week,
    style_tone = p_style_tone,
    info = coalesce(trim(p_info), ''),
    info_warn = coalesce(p_info_warn, false)
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_sailing(uuid, text, int, int, int, int, int[], text, text, boolean) from public;
grant execute on function admin_update_sailing(uuid, text, int, int, int, int, int[], text, text, boolean) to authenticated;


create or replace function admin_update_community_service(
  p_id uuid, p_name text, p_organizer_name text, p_about text, p_on_date date, p_time_mins int,
  p_island_slug text, p_maps_url text, p_meeting_point text, p_what_to_bring text,
  p_safety_notes text, p_min_age int, p_max_age int, p_contact_name text,
  p_contact_phone text, p_whatsapp_group_url text
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

revoke all on function admin_update_community_service(uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text) from public;
grant execute on function admin_update_community_service(uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text) to authenticated;


-- ===========================================================================
-- 2. Schedules / slots / routes — delete-all + re-insert, mirroring the
--    set_partner_* bodies (017 / 044 / 035 / 049).
-- ===========================================================================

create or replace function admin_set_activity_schedule(p_activity_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_capacity int;
  v_days int[];
  v_seen_times int[] := '{}';
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if not exists (select 1 from activities where id = p_activity_id) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    return query select false, 'Add at least one time slot.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one time slot.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many time slots — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_time_mins := (v_slot->>'time_mins')::int;
    v_capacity := (v_slot->>'capacity')::int;

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each slot needs a valid time.'::text;
      return;
    end if;
    if v_capacity is null or v_capacity <= 0 then
      return query select false, 'Each slot needs a capacity greater than zero.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two slots have the same time — give each one a different time.'::text;
      return;
    end if;
    v_seen_times := array_append(v_seen_times, v_time_mins);

    select array_agg(distinct x::int) into v_days
      from jsonb_array_elements_text(coalesce(v_slot->'days_of_week', '[]'::jsonb)) x;
    if v_days is null or array_length(v_days, 1) is null then
      return query select false, 'Each slot needs at least one day it runs.'::text;
      return;
    end if;
    if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      return query select false, 'Each slot needs valid days of the week.'::text;
      return;
    end if;
  end loop;

  delete from activity_schedule where activity_id = p_activity_id;

  insert into activity_schedule (activity_id, time_mins, capacity, days_of_week, closed_reason)
  select
    p_activity_id,
    (s->>'time_mins')::int,
    (s->>'capacity')::int,
    (select array_agg(distinct x::int) from jsonb_array_elements_text(s->'days_of_week') x),
    nullif(trim(s->>'closed_reason'), '')
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Schedule saved.'::text;
end $$;

revoke all on function admin_set_activity_schedule(uuid, jsonb) from public;
grant execute on function admin_set_activity_schedule(uuid, jsonb) to authenticated;


create or replace function admin_set_restaurant_tables(p_restaurant_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_table_count int;
  v_seats_per_table int;
  v_seen_times int[] := '{}';
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    return query select false, 'Add at least one table slot.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one table slot.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many table slots — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_time_mins := (v_slot->>'time_mins')::int;
    v_table_count := (v_slot->>'table_count')::int;
    v_seats_per_table := coalesce((v_slot->>'seats_per_table')::int, 4);

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each slot needs a valid time.'::text;
      return;
    end if;
    if v_table_count is null or v_table_count <= 0 then
      return query select false, 'Each slot needs at least one table.'::text;
      return;
    end if;
    if v_seats_per_table <= 0 then
      return query select false, 'Each slot needs at least one seat per table.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two slots have the same time — give each one a different time.'::text;
      return;
    end if;
    v_seen_times := array_append(v_seen_times, v_time_mins);
  end loop;

  delete from restaurant_tables where restaurant_id = p_restaurant_id;

  insert into restaurant_tables (restaurant_id, time_mins, table_count, seats_per_table, days_of_week)
  select
    p_restaurant_id,
    (s->>'time_mins')::int,
    (s->>'table_count')::int,
    coalesce((s->>'seats_per_table')::int, 4),
    coalesce(
      nullif(
        (select array_agg(distinct x::int)
         from jsonb_array_elements_text(coalesce(s->'days_of_week', '[]'::jsonb)) x
         where x::int between 0 and 6),
        '{}'::int[]
      ),
      '{0,1,2,3,4,5,6}'
    )
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Table slots saved.'::text;
end $$;

revoke all on function admin_set_restaurant_tables(uuid, jsonb) from public;
grant execute on function admin_set_restaurant_tables(uuid, jsonb) to authenticated;


create or replace function admin_set_rental_hours(p_partner_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_slot      jsonb;
  v_count     int;
  v_dow       int;
  v_open      int;
  v_close     int;
  v_seen_dows int[] := '{}';
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if not exists (select 1 from partners where id = p_partner_id and kind = 'rental') then
    return query select false, 'This business is not a rental shop.'::text;
    return;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    return query select false, 'Add at least one open day.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one open day.'::text;
    return;
  end if;
  if v_count > 7 then
    return query select false, 'There are only seven days in a week.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_dow   := (v_slot->>'dow')::int;
    v_open  := (v_slot->>'open_mins')::int;
    v_close := (v_slot->>'close_mins')::int;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      return query select false, 'Each row needs a valid day of the week.'::text;
      return;
    end if;
    if v_open is null or v_close is null or v_open < 0 or v_close > 1439 or v_open >= v_close then
      return query select false, 'Each open day needs an opening time before its closing time.'::text;
      return;
    end if;
    if v_dow = any (v_seen_dows) then
      return query select false, 'One day is listed twice.'::text;
      return;
    end if;
    v_seen_dows := array_append(v_seen_dows, v_dow);
  end loop;

  delete from rental_hours where partner_id = p_partner_id;

  insert into rental_hours (partner_id, dow, open_mins, close_mins)
  select p_partner_id, (s->>'dow')::int, (s->>'open_mins')::int, (s->>'close_mins')::int
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Opening hours saved.'::text;
end $$;

revoke all on function admin_set_rental_hours(uuid, jsonb) from public;
grant execute on function admin_set_rental_hours(uuid, jsonb) to authenticated;


create or replace function admin_set_car_routes(p_cab_id uuid, p_routes jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if not exists (select 1 from cabs where id = p_cab_id) then
    return query select false, 'That car no longer exists.'::text;
    return;
  end if;

  if p_routes is null or jsonb_typeof(p_routes) <> 'array' then
    p_routes := '[]'::jsonb;
  end if;

  for v_row in select * from jsonb_array_elements(p_routes) loop
    if (v_row->>'from_place_id') is null or (v_row->>'to_place_id') is null then
      return query select false, 'Every route needs a pickup and a drop.'::text;
      return;
    end if;
    if (v_row->>'from_place_id') = (v_row->>'to_place_id') then
      return query select false, 'A route''s pickup and drop must differ.'::text;
      return;
    end if;
    if not exists (select 1 from cab_places where id = (v_row->>'from_place_id')::uuid) or
       not exists (select 1 from cab_places where id = (v_row->>'to_place_id')::uuid) then
      return query select false, 'One of those places is no longer on the map.'::text;
      return;
    end if;
    if coalesce((v_row->>'oneway_paise')::int, 0) < 0
       or coalesce((v_row->>'roundtrip_paise')::int, 0) < 0 then
      return query select false, 'Fares can''t be negative.'::text;
      return;
    end if;
  end loop;

  delete from cab_routes where cab_id = p_cab_id;

  insert into cab_routes (cab_id, from_place_id, to_place_id, oneway_paise, roundtrip_paise)
  select p_cab_id,
         (r->>'from_place_id')::uuid,
         (r->>'to_place_id')::uuid,
         greatest(coalesce((r->>'oneway_paise')::int, 0), 0),
         greatest(coalesce((r->>'roundtrip_paise')::int, 0), 0)
  from jsonb_array_elements(p_routes) r
  on conflict (cab_id, from_place_id, to_place_id) do update
    set oneway_paise = excluded.oneway_paise,
        roundtrip_paise = excluded.roundtrip_paise;

  return query select true, 'Route fares saved.'::text;
end $$;

revoke all on function admin_set_car_routes(uuid, jsonb) from public;
grant execute on function admin_set_car_routes(uuid, jsonb) to authenticated;


-- ===========================================================================
-- 3. Per-listing location (071) — activity / table carry their own address.
-- ===========================================================================

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


-- ===========================================================================
-- 4. Photos — a copy of set_listing_photos (037 / 049) with the owner check
--    swapped for an is_admin() gate. Keeps the "mirror path 0 onto the
--    vestigial photo_path column" behaviour.
-- ===========================================================================

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
    when 'ferry' then 'sailings' else null end;
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


-- ===========================================================================
-- 5. Business profile — a superset of update_partner_profile (011) that also
--    lets an admin fix the trading name and island, plus the contact phone.
-- ===========================================================================

create or replace function admin_update_partner_profile(
  p_partner_id uuid, p_name text, p_island_slug text, p_address text, p_maps_url text,
  p_cover_photo_path text, p_license_number text, p_license_doc_path text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the business a name.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  update partners set
    name = trim(p_name),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    address = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), ''),
    cover_photo_path = p_cover_photo_path,
    license_number = nullif(trim(p_license_number), ''),
    license_doc_path = p_license_doc_path
  where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_partner_profile(uuid, text, text, text, text, text, text, text) from public;
grant execute on function admin_update_partner_profile(uuid, text, text, text, text, text, text, text) to authenticated;


create or replace function admin_set_partner_contact_phone(p_partner_id uuid, p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_clean text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  -- Same cleaning as set_partner_contact_phone (023): keep digits and a
  -- leading +, assume India when there's no country code.
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set contact_phone = nullif(v_clean, '') where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_contact_phone(uuid, text) from public;
grant execute on function admin_set_partner_contact_phone(uuid, text) to authenticated;


-- ===========================================================================
-- 6. Storage — an admin uploads photos straight to the partner-photos bucket
--    (client-side, not through a definer RPC), so storage.objects needs its
--    own admin policy alongside the "partners manage own photos" one (011).
-- ===========================================================================

drop policy if exists "admins manage all partner photos" on storage.objects;
create policy "admins manage all partner photos" on storage.objects
  for all
  using      (bucket_id = 'partner-photos' and is_admin())
  with check (bucket_id = 'partner-photos' and is_admin());

-- Licence documents too, so an admin can (re-)upload a partner's licence while
-- fixing their profile. 012 already lets an admin READ this private bucket;
-- this adds the write. Same is_admin() gate.
drop policy if exists "admins manage all partner license docs" on storage.objects;
create policy "admins manage all partner license docs" on storage.objects
  for all
  using      (bucket_id = 'partner-licenses' and is_admin())
  with check (bucket_id = 'partner-licenses' and is_admin());


select 'admin listing edits installed' as done;
