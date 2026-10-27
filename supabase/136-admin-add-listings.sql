-- Admin-created listings: let an admin add a listing on behalf of any
-- registered business, for partners who can't or won't fill the forms
-- themselves (the admin Listings tab's "Add listing" button).
--
-- One admin_add_<kind> per catalogue kind, each the exact twin of the partner's
-- add_partner_<kind> — same validation, same defaults, same landing spot
-- (is_listed = false, so it shows up under "Waiting" for a one-click approve)
-- — except the business comes from a p_partner_id the admin supplies instead
-- of being derived from auth.uid() -> partner_users. Gated by is_admin(),
-- same as every other admin_* RPC. Generated from the live add_partner_*
-- definitions so the two can't drift on day one; if a partner add function
-- gains a rule later, its admin twin needs the same change.

CREATE OR REPLACE FUNCTION public.admin_add_activity(p_partner_id uuid, p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, activity_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_mark text;
  v_id uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
  end if;

  if p_category not in ('scuba', 'seawalk', 'snorkel', 'water', 'stargazing') then
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_vehicle(p_partner_id uuid, p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, vehicle_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_code text;
  v_seats int;
  v_units int;
  v_exists boolean;
  v_id uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_car(p_partner_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer DEFAULT 0, p_night_surcharge_paise integer DEFAULT 0, p_per_km_paise integer DEFAULT 0, p_per_min_paise integer DEFAULT 0, p_meta text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, cab_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from partners where id = v_partner and kind = 'cab') then
    return query select false, 'This business is not a cab operator.'::text, null::uuid;
    return;
  end if;

  if p_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid car type.'::text, null::uuid;
    return;
  end if;
  if p_fuel not in ('ev','petrol','diesel') then
    return query select false, 'Choose petrol, diesel or electric.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the car a model name.'::text, null::uuid;
    return;
  end if;
  if p_full_day_paise is null or p_full_day_paise < 0 then
    return query select false, 'Enter a valid full-day fare.'::text, null::uuid;
    return;
  end if;

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_model), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    select exists(select 1 from cabs where partner_id = v_partner and code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into cabs (
    code, partner_id, category, model, seats, luggage, ac, fuel, board_number,
    full_day_paise, airport_surcharge_paise, night_surcharge_paise,
    per_km_paise, per_min_paise, meta, is_listed, photo_path
  ) values (
    v_code, v_partner, p_category, trim(p_model),
    greatest(coalesce(p_seats, 4), 1), greatest(coalesce(p_luggage, 0), 0),
    coalesce(p_ac, true), p_fuel, nullif(trim(p_board_number), ''),
    p_full_day_paise, greatest(coalesce(p_airport_surcharge_paise, 0), 0),
    greatest(coalesce(p_night_surcharge_paise, 0), 0),
    greatest(coalesce(p_per_km_paise, 0), 0), greatest(coalesce(p_per_min_paise, 0), 0),
    coalesce(trim(p_meta), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_add_stay(p_partner_id uuid, p_name text, p_island_slug text, p_property_type text, p_area text, p_tagline text DEFAULT ''::text, p_about text DEFAULT ''::text, p_amenities text[] DEFAULT '{}'::text[], p_house_rules text DEFAULT ''::text, p_cancellation_policy text DEFAULT 'moderate'::text, p_check_in_mins integer DEFAULT 840, p_check_out_mins integer DEFAULT 660, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, stay_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from partners where id = v_partner and kind = 'stay') then
    return query select false, 'This business is not registered as a stay.'::text, null::uuid;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose which island this property is actually on.'::text, null::uuid;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel','hotel') then
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

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'stays');

  insert into stays (
    slug, partner_id, island_slug, mark, name, property_type, area, tagline, about,
    amenities, house_rules, cancellation_policy, check_in_mins, check_out_mins,
    is_listed, photo_path
  ) values (
    v_slug, v_partner, p_island_slug, v_mark, trim(p_name), p_property_type,
    coalesce(nullif(trim(p_area), ''), 'Near the property'),
    coalesce(trim(p_tagline), ''), coalesce(trim(p_about), ''),
    coalesce(p_amenities, '{}'), coalesce(trim(p_house_rules), ''), p_cancellation_policy,
    p_check_in_mins, p_check_out_mins, false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. Add your room types next, then submit for review.'::text, v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_add_event(p_partner_id uuid, p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text DEFAULT 'all-ages'::text, p_performer text DEFAULT NULL::text, p_photo_path text DEFAULT NULL::text, p_island_slug text DEFAULT NULL::text, p_maps_url text DEFAULT NULL::text, p_end_time_mins integer DEFAULT NULL::integer)
 RETURNS TABLE(ok boolean, message text, event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_community_service(p_partner_id uuid, p_name text, p_organizer_name text, p_about text, p_on_date date, p_time_mins integer, p_island_slug text DEFAULT NULL::text, p_maps_url text DEFAULT NULL::text, p_meeting_point text DEFAULT ''::text, p_what_to_bring text DEFAULT NULL::text, p_safety_notes text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_contact_name text DEFAULT ''::text, p_contact_phone text DEFAULT ''::text, p_whatsapp_group_url text DEFAULT NULL::text, p_end_time_mins integer DEFAULT NULL::integer)
 RETURNS TABLE(ok boolean, message text, community_service_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_trip(p_partner_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[] DEFAULT '{}'::text[], p_bring_list text[] DEFAULT '{}'::text[], p_meet_point text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text, p_departs_mins integer DEFAULT 360, p_run_dates date[] DEFAULT '{}'::date[], p_meet_at_hotel boolean DEFAULT false, p_maps_url text DEFAULT NULL::text, p_ends_mins integer DEFAULT NULL::integer)
 RETURNS TABLE(ok boolean, message text, trip_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_id uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
    return;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_sailing(p_partner_id uuid, p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[], p_style_tone text DEFAULT 'plain'::text, p_info text DEFAULT ''::text, p_info_warn boolean DEFAULT false, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, sailing_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_partner := p_partner_id;
  if not exists (select 1 from partners where id = v_partner) then
    return query select false, 'That business no longer exists.'::text, null::uuid;
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
  if p_from_island = p_to_island then
    return query select false, 'Departure and arrival islands must be different.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_style_label), '') = '' then
    return query select false, 'Give the ticket class a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(p_style_tone, 'plain') not in ('good', 'warm', 'plain') then
    return query select false, 'Choose a valid badge style.'::text, null::uuid;
    return;
  end if;
  if p_dep_mins is null or p_dep_mins not between 0 and 1439 then
    return query select false, 'Choose a valid departure time.'::text, null::uuid;
    return;
  end if;
  if p_duration_mins is null or p_duration_mins < 1 then
    return query select false, 'Enter a valid journey time.'::text, null::uuid;
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

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_style_label), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    select exists(select 1 from sailings where code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into sailings (
    code, partner_id, from_island, to_island, style_label, dep_mins,
    duration_mins, fare_paise, capacity, days_of_week, style_tone, info,
    info_warn, is_listed, photo_path
  ) values (
    v_code, v_partner, p_from_island, p_to_island, trim(p_style_label), p_dep_mins,
    p_duration_mins, p_fare_paise, p_capacity, coalesce(p_days_of_week, '{0,1,2,3,4,5,6}'),
    coalesce(p_style_tone, 'plain'), coalesce(trim(p_info), ''), coalesce(p_info_warn, false),
    false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$function$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'admin_add_activity', 'admin_add_vehicle', 'admin_add_car', 'admin_add_stay',
        'admin_add_event', 'admin_add_community_service', 'admin_add_trip', 'admin_add_sailing'
      )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
