--
-- PostgreSQL database dump
--

\restrict rLOh3vEwNjqvIhUaWcpbLN17evGw1PlDvoIdgqf8TRbTUyL4exDO3btaWLCc6jS

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_partner_invite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_partner_invite(p_invite_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_pid    uuid;
  v_role   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if exists (select 1 from partner_users where user_id = auth.uid()) then
    return query select false, 'This account is already linked to a business.'::text;
    return;
  end if;

  select partner_id, role into v_pid, v_role
  from partner_invites
  where id = p_invite_id and accepted_at is null and lower(email) = v_email;

  if v_pid is null then
    return query select false, 'That invite is no longer valid.'::text;
    return;
  end if;

  insert into partner_users (user_id, partner_id, role)
  values (auth.uid(), v_pid, v_role);

  update partner_invites set accepted_at = now() where id = p_invite_id;

  return query select true, 'You''re on the team.'::text;
end $$;


--
-- Name: add_partner_activity(text, text, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_activity(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, activity_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_activity_impl(
    p_category, p_name, p_summary, p_about, p_price_paise, p_photo_path
  );
end $$;


--
-- Name: add_partner_activity_impl(text, text, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_activity_impl(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, activity_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: add_partner_car(text, text, integer, integer, boolean, text, text, integer, integer, integer, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer DEFAULT 0, p_night_surcharge_paise integer DEFAULT 0, p_per_km_paise integer DEFAULT 0, p_per_min_paise integer DEFAULT 0, p_meta text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, cab_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
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
end $$;


--
-- Name: add_partner_event(text, text, text, text, date, integer, integer, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text DEFAULT 'all-ages'::text, p_performer text DEFAULT NULL::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text, null::uuid;
    return;
  end if;
  if p_genre in ('dj', 'live') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, entry_paise, capacity, rating, reviews, about,
    age_restriction, performer, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''),
    p_age_restriction, nullif(trim(p_performer), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;


--
-- Name: add_partner_event_impl(text, text, text, text, date, integer, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_event_impl(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    return query select false, 'Choose a valid event genre.'::text, null::uuid;
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
  if p_on_date is null or p_on_date < current_date then
    return query select false, 'Choose a date in the future.'::text, null::uuid;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a valid start time.'::text, null::uuid;
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
    slug, partner_id, island_slug, genre, mark, name, venue, area, on_date,
    time_mins, entry_paise, capacity, rating, reviews, about, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'), p_on_date, p_time_mins,
    p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;


--
-- Name: add_partner_restaurant(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_restaurant(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, restaurant_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_restaurant_impl(
    p_category, p_name, p_area, p_price_tier, p_blurb, p_about, p_photo_path
  );
end $$;


--
-- Name: add_partner_restaurant_impl(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_restaurant_impl(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, restaurant_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    return query select false, 'Choose a valid cuisine category.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the restaurant a name.'::text, null::uuid;
    return;
  end if;
  if p_price_tier is null or p_price_tier not between 1 and 3 then
    return query select false, 'Choose a price range.'::text, null::uuid;
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


--
-- Name: add_partner_sailing(text, text, text, integer, integer, integer, integer, integer[], text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_sailing(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text DEFAULT 'plain'::text, p_info text DEFAULT ''::text, p_info_warn boolean DEFAULT false, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, sailing_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_sailing_impl(
    p_from_island, p_to_island, p_style_label, p_dep_mins, p_duration_mins,
    p_fare_paise, p_capacity, p_days_of_week, p_style_tone, p_info,
    p_info_warn, p_photo_path
  );
end $$;


--
-- Name: add_partner_sailing_impl(text, text, text, integer, integer, integer, integer, integer[], text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_sailing_impl(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[], p_style_tone text DEFAULT 'plain'::text, p_info text DEFAULT ''::text, p_info_warn boolean DEFAULT false, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, sailing_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: add_partner_trip(text, text, text, text, integer[], integer, text, integer, integer, text, text[], text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[] DEFAULT '{}'::text[], p_bring_list text[] DEFAULT '{}'::text[], p_meet_point text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, trip_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  if coalesce(trim(p_meet_point), '') = '' then
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
    runs_on_days, price_paise, difficulty, min_seats, seats_total, rating, reviews,
    summary, includes, bring_list, meet_point, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_difficulty, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), coalesce(p_bring_list, '{}'),
    trim(p_meet_point), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;


--
-- Name: add_partner_trip_impl(text, text, text, text, integer[], integer, integer, integer, integer, text, text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_trip_impl(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, trip_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    return query select false, 'Give the trip a host name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Add a meeting point.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;
  if p_deposit_paise is null or p_deposit_paise < 0 or p_deposit_paise > p_price_paise then
    return query select false, 'Deposit must be between 0 and the full price.'::text, null::uuid;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text, null::uuid;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Minimum seats must be between 1 and the total seats.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_slug := unique_slug(p_title, 'trips');

  insert into trips (
    slug, partner_id, island_slug, title, host_name, host_since, duration_label,
    runs_on_days, price_paise, deposit_paise, min_seats, seats_total, rating,
    reviews, summary, includes, meet_point, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name),
    coalesce(nullif(trim(p_host_since), ''), 'New host'), coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_deposit_paise, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), trim(p_meet_point), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;


--
-- Name: add_partner_vehicle(text, text, integer, integer, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_vehicle(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, vehicle_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_vehicle_impl(
    p_type, p_model, p_rate_paise, p_seats, p_meta, p_units, p_photo_path
  );
end $$;


--
-- Name: add_partner_vehicle_impl(text, text, integer, integer, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_partner_vehicle_impl(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, vehicle_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: adjust_booking_party(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_booking_party(p_item_id uuid, p_party integer) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner  uuid;
  v_state    text;
  v_party    int;
  v_redeemed timestamptz;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, party, redeemed_at into v_state, v_party, v_redeemed
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_redeemed is not null then
    return query select false, 'Already checked in — the party can''t be changed now.'::text;
    return;
  end if;
  if v_state <> 'confirmed' then
    return query select false, 'Only a confirmed booking can be adjusted.'::text;
    return;
  end if;
  if p_party is null or p_party < 1 or p_party > v_party then
    return query select false,
      format('Enter a number between 1 and %s.', v_party)::text;
    return;
  end if;

  update booking_items set party = p_party where id = p_item_id;

  return query select true, format('Party set to %s.', p_party)::text;
end $$;


--
-- Name: admin_approve_listing(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_approve_listing(p_kind text, p_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_approve_partner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_approve_partner(p_partner_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update partners set status = 'approved', rejection_reason = null
  where id = p_partner_id;

  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Approved.'::text;
end;
$$;


--
-- Name: admin_booking_thread(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_booking_thread(p_item_id uuid) RETURNS TABLE(sender text, body text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select sender, body, created_at
  from booking_messages
  where item_id = p_item_id and is_admin()
  order by created_at;
$$;


--
-- Name: admin_cancel_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_cancel_booking(p_item_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_state text;
  v_paid  int;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before cancelling.'::text;
    return;
  end if;

  select state, paid_online_paise into v_state, v_paid
  from booking_items where id = p_item_id for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason),
      cancelled_at = now()
  where id = p_item_id;

  return query select true, 'Cancelled.'::text;
end $$;


--
-- Name: admin_mark_support_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_mark_support_read(p_partner_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update support_messages
  set read_at = now()
  where partner_id = p_partner_id and sender = 'partner' and read_at is null;
end $$;


--
-- Name: admin_partner_invites(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_partner_invites(p_partner_id uuid) RETURNS TABLE(email text, role text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select email, role, created_at
  from partner_invites
  where partner_id = p_partner_id and accepted_at is null and is_admin()
  order by created_at;
$$;


--
-- Name: admin_partner_team(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_partner_team(p_partner_id uuid) RETURNS TABLE(email text, role text, joined_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.email, pu.role, pu.created_at
  from partner_users pu
  join auth.users u on u.id = pu.user_id
  where pu.partner_id = p_partner_id and is_admin()
  order by (pu.role <> 'owner'), pu.created_at;
$$;


--
-- Name: admin_place_ferry_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_place_ferry_booking(p_item_id uuid, p_pnr text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_kind text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_pnr), '') = '' then
    return query select false, 'Enter the operator PNR.'::text;
    return;
  end if;

  select kind into v_kind from booking_items where id = p_item_id;
  if v_kind is null then
    return query select false, 'That booking no longer exists.'::text;
    return;
  end if;
  if v_kind <> 'ferry' then
    return query select false, 'That is not a ferry booking.'::text;
    return;
  end if;

  update booking_items set ticket_code = trim(p_pnr) where id = p_item_id;

  return query select true, 'Placed. The traveller now sees the PNR.'::text;
end $$;


--
-- Name: admin_reactivate_partner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reactivate_partner(p_partner_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  select status into v_status from partners where id = p_partner_id for update;
  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;
  if v_status <> 'suspended' then
    return query select false, 'That business is not suspended.'::text;
    return;
  end if;
  update partners
  set status = 'approved', rejection_reason = null
  where id = p_partner_id;
  return query select true, 'Back online.'::text;
end;
$$;


--
-- Name: admin_reject_listing(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reject_listing(p_kind text, p_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_reject_partner(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reject_partner(p_partner_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before rejecting.'::text;
    return;
  end if;

  update partners set status = 'rejected', rejection_reason = trim(p_reason)
  where id = p_partner_id;

  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Rejected.'::text;
end;
$$;


--
-- Name: admin_remove_review(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_review(p_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  -- The delete fires recompute_listing_rating (031), so the listing's star
  -- rating re-blends without this review straight away.
  delete from reviews where id = p_id;

  if not found then
    return query select false, 'Review not found.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end $$;


--
-- Name: admin_reply_support(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reply_support(p_partner_id uuid, p_body text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a reply first.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (p_partner_id, 'open', now())
  on conflict (partner_id) do update set updated_at = now();

  insert into support_messages (partner_id, sender, body)
  values (p_partner_id, 'admin', trim(p_body));

  return query select true, 'Reply sent.'::text;
end $$;


--
-- Name: admin_set_support_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_support_status(p_partner_id uuid, p_status text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_status not in ('open', 'resolved') then
    return query select false, 'Unknown status.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (p_partner_id, p_status, now())
  on conflict (partner_id) do update set status = p_status, updated_at = now();

  return query select true, 'Updated.'::text;
end $$;


--
-- Name: admin_suspend_partner(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_suspend_partner(p_partner_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before suspending.'::text;
    return;
  end if;
  select status into v_status from partners where id = p_partner_id for update;
  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;
  if v_status <> 'approved' then
    return query select false, 'Only a live business can be suspended.'::text;
    return;
  end if;
  update partners
  set status = 'suspended', rejection_reason = trim(p_reason)
  where id = p_partner_id;
  return query select true, 'Suspended.'::text;
end;
$$;


--
-- Name: admin_unlist_listing(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_unlist_listing(p_kind text, p_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: assert_partner_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_partner_owner() RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from partner_users
    where user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'only the business owner can do this' using errcode = '42501';
  end if;
end $$;


--
-- Name: cab_load_on(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cab_load_on(p_date date) RETURNS TABLE(cab_code text, out_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.code, count(*)
  from booking_items bi
  join cabs c on c.id = bi.cab_id
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.state in ('pending','confirmed','disrupted','completed')
    and p_date >= (bi.starts_at at time zone 'Asia/Kolkata')::date
    and p_date <= case d.trip_type
          when 'fullday'   then (bi.starts_at at time zone 'Asia/Kolkata')::date + (d.days - 1)
          when 'roundtrip' then coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date)
          else (bi.starts_at at time zone 'Asia/Kolkata')::date
        end
  group by c.code
$$;


--
-- Name: cancel_my_booking_item(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_my_booking_item(p_item_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user    uuid := auth.uid();
  v_state   text;
  v_starts  timestamptz;
  v_partner uuid;
  v_kind    text;
  v_subject uuid;
  v_mode    text;
  v_price   int;
  v_paid    int;
  v_refund  int;
  v_title   text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.state, i.starts_at, i.partner_id, i.kind, i.subject_id,
         i.pay_mode, i.price_paise, i.paid_online_paise
    into v_state, v_starts, v_partner, v_kind, v_subject,
         v_mode, v_price, v_paid
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be cancelled here.'::text;
    return;
  end if;

  -- The rule.
  if v_mode = 'deposit' then
    v_refund := 0;
  elsif now() <= v_starts - interval '24 hours' then
    v_refund := round(v_price * 0.5)::int;
  else
    v_refund := 0;
  end if;

  -- Never hand back more than came in (belt and braces — for a full payment
  -- paid_online_paise = price, so half of it is always covered).
  v_refund := least(v_refund, v_paid);

  update booking_items
  set state = 'refunded', refunded_paise = v_refund, cancelled_at = now()
  where id = p_item_id;

  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'Booking cancelled by the traveller',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, case
    when v_refund > 0 then 'Cancelled. Half comes back to you.'
    when v_mode = 'deposit' then 'Cancelled. The deposit is not refundable.'
    else 'Cancelled. Inside 24 hours, nothing is refunded.'
  end::text;
end $$;


--
-- Name: clear_no_show(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_no_show(p_item_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_state   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state into v_state
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state <> 'missed' then
    return query select false, 'That booking isn''t marked a no-show.'::text;
    return;
  end if;

  update booking_items set state = 'confirmed' where id = p_item_id;

  return query select true, 'No-show undone.'::text;
end $$;


--
-- Name: close_partner_date(text, uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    -- a rental's subject is the shop itself (partners.id)
    v_owns := (p_subject_id = v_partner);
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


--
-- Name: close_partner_date_impl(text, uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: create_booking(text, text, timestamp with time zone, integer, integer, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer DEFAULT 1, p_units integer DEFAULT 1, p_variant text DEFAULT NULL::text, p_extras boolean DEFAULT false, p_pay_mode text DEFAULT 'full'::text) RETURNS TABLE(ref_code text, ticket_code text, price_paise integer, state text, paid_online_paise integer, balance_paise integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user       uuid := auth.uid();
  v_subject_id uuid;
  v_partner_id uuid;
  v_variant_id uuid;
  v_stock      int;
  v_peak       int;
  v_island     text;
  v_price      int;
  v_capacity   int;
  v_taken      int;
  v_needed     int := p_party;
  v_mode       text;
  v_deposit    int;
  v_paid       int;
  v_balance    int;
  v_state      text;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
  v_kind_seq   int;
  v_phone      text;
  v_email      text;
  v_day        date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_time_mins  int  := extract(hour from p_starts_at at time zone 'Asia/Kolkata') * 60
                     + extract(minute from p_starts_at at time zone 'Asia/Kolkata');
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_party < 1 or p_units < 1 then
    raise exception 'party and units must be at least 1' using errcode = '22023';
  end if;
  if p_party > 100 or p_units > 366 then
    raise exception 'party or units out of range' using errcode = '22023';
  end if;

  case p_kind

    when 'activity' then
      select a.id, a.partner_id, a.island_slug, a.price_paise * p_party, s.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from activities a
      join activity_schedule s on s.activity_id = a.id and s.time_mins = v_time_mins
      where a.slug = p_subject and a.is_listed;

      if v_capacity is null then
        raise exception 'no activity "%" runs at that time', p_subject using errcode = '22023';
      end if;

    when 'ferry' then
      select s.id, s.partner_id, s.to_island, s.fare_paise * p_party, s.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from sailings s
      where s.code = p_subject and s.is_listed and s.dep_mins = v_time_mins;

    when 'table' then
      select r.id, r.partner_id, r.island_slug, 0, t.table_count
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from restaurants r
      join restaurant_tables t on t.restaurant_id = r.id and t.time_mins = v_time_mins
      where r.slug = p_subject and r.is_listed;

      v_needed := 1;

    when 'event' then
      select e.id, e.partner_id, e.island_slug, e.entry_paise * p_party, e.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from events e
      where e.slug = p_subject and e.is_listed and e.on_date = v_day;

    when 'trip' then
      select t.id, t.partner_id, t.island_slug, t.price_paise * p_party, t.seats_total
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from trips t
      where t.slug = p_subject and t.is_listed;

    when 'rental' then
      select p.id, v.id, p.id, p.island_slug,
             v.rate_paise * p_units + case when p_extras then 10000 else 0 end,
             null, v.units
        into v_subject_id, v_variant_id, v_partner_id, v_island, v_price,
             v_capacity, v_stock
      from partners p
      join vehicles v on v.partner_id = p.id and v.code = p_variant and v.is_listed
      where p.slug = p_subject and p.status = 'approved';

    else
      raise exception 'unknown booking kind "%"', p_kind using errcode = '22023';
  end case;

  if v_subject_id is null then
    raise exception 'nothing bookable found for % "%"', p_kind, p_subject using errcode = '22023';
  end if;

  if exists (
    select 1 from listing_closures
    where kind = p_kind and subject_id = v_subject_id and on_date = v_day
  ) then
    raise exception 'that date is closed to bookings' using errcode = 'P0001';
  end if;

  if v_capacity is not null then
    select taken into v_taken
    from availability
    where kind = p_kind and subject_id = v_subject_id and starts_at = p_starts_at
    for update;

    v_taken := coalesce(v_taken, 0);

    if v_taken + v_needed > v_capacity then
      raise exception 'only % left', greatest(0, v_capacity - v_taken)
        using errcode = '23514';
    end if;
  end if;

  if p_kind = 'rental' then
    if exists (select 1 from rental_hours where partner_id = v_partner_id) then
      if not exists (
        select 1 from rental_hours
        where partner_id = v_partner_id
          and dow = extract(dow from v_day)::int
          and v_time_mins between open_mins and close_mins
      ) then
        raise exception 'the shop is not open for pick-up at that time'
          using errcode = 'P0001';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtext('rental:' || v_variant_id::text));

    select coalesce(max(day_load), 0) into v_peak
    from (
      select g.n, count(*) as day_load
      from generate_series(0, p_units - 1) as g(n)
      join booking_items bi
        on bi.kind = 'rental'
       and bi.variant_id = v_variant_id
       and bi.state in ('pending', 'confirmed', 'disrupted', 'completed')
       and (v_day + g.n) >= (bi.starts_at at time zone 'Asia/Kolkata')::date
       and (v_day + g.n) <  (bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units
      group by g.n
    ) x;

    if v_peak + 1 > v_stock then
      raise exception 'only % left', greatest(0, v_stock - v_peak)
        using errcode = '23514';
    end if;
  end if;

  select mode into v_mode from category_payment where kind = p_kind;
  v_mode := coalesce(v_mode, 'full');

  if p_pay_mode not in ('full', 'deposit') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;
  if p_pay_mode = 'deposit' and v_mode <> 'choice' then
    raise exception 'this booking has to be paid in full' using errcode = '22023';
  end if;

  v_deposit := round(v_price * 0.30)::int;
  if p_pay_mode = 'deposit' then
    v_paid    := v_deposit;
    v_balance := v_price - v_deposit;
  else
    v_paid    := v_price;
    v_balance := 0;
  end if;

  v_state := 'confirmed';

  select id, bookings.ref_code into v_booking, v_ref
  from bookings
  where user_id = v_user and on_date = v_day
  limit 1;

  if v_booking is null then
    v_ref := new_ref_code();

    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;

    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, v_island, v_day, v_phone, v_email)
    returning id into v_booking;
  end if;

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = p_kind;

  v_ticket := v_ref || '-' || upper(left(p_kind, 1))
            || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, variant_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     p_party, p_units, v_price, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now());

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;


--
-- Name: create_cab_booking(text, text, text, uuid, uuid, timestamp with time zone, date, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date DEFAULT NULL::date, p_days integer DEFAULT 1, p_pickup_note text DEFAULT ''::text, p_pay_mode text DEFAULT 'none'::text) RETURNS TABLE(ref_code text, ticket_code text, fare_paise integer, paid_online_paise integer, balance_paise integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user      uuid := auth.uid();
  v_operator  uuid;
  v_cab_id    uuid;
  v_island    text;
  v_full_day  int;
  v_air_sur   int;
  v_night_sur int;
  v_base      int;
  v_fare      int;
  v_days      int := greatest(coalesce(p_days, 1), 1);
  v_start_day date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_end_day   date;
  v_time_mins int := extract(hour from p_starts_at at time zone 'Asia/Kolkata') * 60
                   + extract(minute from p_starts_at at time zone 'Asia/Kolkata');
  v_is_airport boolean;
  v_night     boolean;
  v_clash     int;
  v_paid      int;
  v_balance   int;
  v_booking   uuid;
  v_ref       text;
  v_ticket    text;
  v_kind_seq  int;
  v_item      uuid;
  v_phone     text;
  v_email     text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_trip_type not in ('oneway','roundtrip','fullday') then
    raise exception 'unknown trip type "%"', p_trip_type using errcode = '22023';
  end if;
  if p_pay_mode not in ('none','full') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;

  select p.id, c.id, p.island_slug, c.full_day_paise,
         c.airport_surcharge_paise, c.night_surcharge_paise
    into v_operator, v_cab_id, v_island, v_full_day, v_air_sur, v_night_sur
  from partners p
  join cabs c on c.partner_id = p.id and c.code = p_cab and c.is_listed
  where p.slug = p_operator and p.kind = 'cab' and p.status = 'approved';

  if v_cab_id is null then
    raise exception 'nothing bookable found for cab "%"', p_cab using errcode = '22023';
  end if;

  -- Fare.
  if p_trip_type = 'fullday' then
    v_base := v_full_day * v_days;
    v_end_day := v_start_day + (v_days - 1);
  else
    if p_from is null or p_to is null or p_from = p_to then
      raise exception 'a pickup and a drop are required' using errcode = '22023';
    end if;

    select case when p_trip_type = 'roundtrip' then roundtrip_paise else oneway_paise end
      into v_base
    from cab_routes
    where cab_id = v_cab_id and from_place_id = p_from and to_place_id = p_to;

    if v_base is null or v_base <= 0 then
      raise exception 'no fare set for this route' using errcode = '22023';
    end if;

    if p_trip_type = 'roundtrip' then
      if p_return_date is null or p_return_date < v_start_day then
        raise exception 'the return date must be on or after the pickup date' using errcode = '22023';
      end if;
      v_end_day := p_return_date;
    else
      v_end_day := v_start_day;
    end if;
  end if;

  v_is_airport := p_trip_type <> 'fullday' and exists (
    select 1 from cab_places where id in (p_from, p_to) and is_airport
  );
  v_night := v_time_mins >= 22 * 60 or v_time_mins < 6 * 60;

  v_fare := v_base
          + case when v_is_airport then v_air_sur else 0 end
          + case when v_night then v_night_sur else 0 end;

  -- Is this car free across [v_start_day .. v_end_day]? One car = one unit.
  perform pg_advisory_xact_lock(hashtext('cab:' || v_cab_id::text));

  select count(*) into v_clash
  from booking_items bi
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.cab_id = v_cab_id
    and bi.state in ('pending','confirmed','disrupted','completed')
    and (bi.starts_at at time zone 'Asia/Kolkata')::date <= v_end_day
    and case d.trip_type
          when 'fullday'   then (bi.starts_at at time zone 'Asia/Kolkata')::date + (d.days - 1)
          when 'roundtrip' then coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date)
          else (bi.starts_at at time zone 'Asia/Kolkata')::date
        end >= v_start_day;

  if v_clash > 0 then
    raise exception 'this car is booked for those dates' using errcode = '23514';
  end if;

  -- Payment split.
  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := 0; v_balance := v_fare;
  end if;

  -- One reference per traveller per day, same as create_booking.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, v_island, v_start_day, v_phone, v_email)
    returning id into v_booking;
  end if;

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = 'cab';

  v_ticket := v_ref || '-C' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, cab_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at)
  values
    (v_booking, 'cab', v_operator, v_cab_id, v_operator, p_starts_at,
     1, case when p_trip_type = 'fullday' then v_days else 1 end,
     v_fare, p_pay_mode, v_paid, v_balance,
     'confirmed', v_ticket, now())
  returning id into v_item;

  insert into cab_trip_details
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note)
  values
    (v_item, p_trip_type,
     case when p_trip_type = 'fullday' then null else p_from end,
     case when p_trip_type = 'fullday' then null else p_to end,
     case when p_trip_type = 'roundtrip' then p_return_date else null end,
     v_days, coalesce(trim(p_pickup_note), ''));

  return query select v_ref, v_ticket, v_fare, v_paid, v_balance;
end $$;


--
-- Name: invite_partner_staff(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_partner_staff(p_email text, p_role text DEFAULT 'staff'::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_partner uuid;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_role    text := coalesce(nullif(trim(p_role), ''), 'staff');
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can invite people.'::text;
    return;
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That doesn''t look like an email address.'::text;
    return;
  end if;
  if v_role not in ('owner', 'staff') then
    return query select false, 'Pick a valid role.'::text;
    return;
  end if;

  if exists (
    select 1 from partner_users pu
    join auth.users u on u.id = pu.user_id
    where pu.partner_id = v_partner and lower(u.email) = v_email
  ) then
    return query select false, 'That person is already on your team.'::text;
    return;
  end if;

  insert into partner_invites (partner_id, email, role, invited_by)
  values (v_partner, v_email, v_role, auth.uid())
  on conflict (partner_id, email) do update set
    role        = excluded.role,
    invited_by  = excluded.invited_by,
    created_at  = now(),
    accepted_at = null;

  return query select true,
    'Invited. They accept it the next time they sign in with that email.'::text;
end $_$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;


--
-- Name: is_partner_for_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_partner_for_booking(p_booking_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from booking_items bi
    join partner_users pu on pu.partner_id = bi.partner_id
    where bi.booking_id = p_booking_id
      and pu.user_id = auth.uid()
  );
$$;


--
-- Name: leave_review(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_review(p_item_id uuid, p_rating integer, p_body text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user     uuid := auth.uid();
  v_booking  uuid;
  v_partner  uuid;
  v_kind     text;
  v_subject  uuid;
  v_redeemed timestamptz;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'Pick a rating from 1 to 5.'::text;
    return;
  end if;

  if p_body is not null and length(p_body) > 2000 then
    return query select false, 'Keep your review under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id, i.partner_id, i.kind, i.subject_id, i.redeemed_at
    into v_booking, v_partner, v_kind, v_subject, v_redeemed
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_kind = 'ferry' then
    return query select false, 'Ferry crossings can''t be reviewed.'::text;
    return;
  end if;

  if v_redeemed is null then
    return query select false, 'You can review this once the operator has checked you in.'::text;
    return;
  end if;

  insert into reviews (item_id, booking_id, user_id, partner_id, kind, subject_id, rating, body)
  values (p_item_id, v_booking, v_user, v_partner, v_kind, v_subject, p_rating,
          nullif(trim(p_body), ''))
  on conflict (item_id) do update set
    rating     = excluded.rating,
    body       = excluded.body,
    created_at = now();

  return query select true, 'Thanks — your review is in.'::text;
end $$;


--
-- Name: listing_is_public(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listing_is_public(p_kind text, p_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    else v := false;
  end case;
  return coalesce(v, false);
end $$;


--
-- Name: listing_partner_id(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listing_partner_id(p_kind text, p_id uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    else v := null;
  end case;
  return v;
end $$;


--
-- Name: listing_reviews(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listing_reviews(p_kind text, p_subject text) RETURNS TABLE(rating integer, body text, reply text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: look_up_booking(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.look_up_booking(p_code text) RETURNS TABLE(found boolean, item_id uuid, ref_code text, kind text, title text, party integer, starts_at timestamp with time zone, price_paise integer, state text, redeemed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_code    text := normalise_code(p_code);
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  return query
  select true,
         i.id, b.ref_code, i.kind, subject_title(i.kind, i.subject_id),
         i.party, i.starts_at, i.price_paise, i.state, i.redeemed_at
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.partner_id = v_partner
    and (normalise_code(i.ticket_code) = v_code or normalise_code(b.ref_code) = v_code)
    and i.state <> 'refunded'
  -- Unredeemed first, then earliest: if a shop has two of somebody's bookings
  -- under one reference, check in the one they have not used yet.
  order by (i.redeemed_at is not null), i.starts_at
  limit 1;
end $$;


--
-- Name: mark_booking_messages_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_booking_messages_read(p_item_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (
    select 1 from booking_items where id = p_item_id and partner_id = v_partner
  ) then
    return;
  end if;

  update booking_messages
  set read_at = now()
  where item_id = p_item_id and sender = 'traveller' and read_at is null;

  -- Opening the thread also counts as seeing its bell notifications.
  update partner_notifications
  set read_at = now()
  where partner_id = v_partner
    and item_id = p_item_id
    and kind = 'booking_message'
    and read_at is null;
end $$;


--
-- Name: mark_no_show(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_no_show(p_item_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner  uuid;
  v_state    text;
  v_starts   timestamptz;
  v_redeemed timestamptz;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, starts_at, redeemed_at into v_state, v_starts, v_redeemed
  from booking_items where id = p_item_id and partner_id = v_partner
  for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_redeemed is not null then
    return query select false, 'They were already checked in.'::text;
    return;
  end if;
  if v_state <> 'confirmed' then
    return query select false, 'Only a confirmed booking can be marked a no-show.'::text;
    return;
  end if;
  if v_starts > now() then
    return query select false, 'This booking hasn''t started yet.'::text;
    return;
  end if;

  -- sync_availability (004) doesn't count 'missed', so this frees the slot —
  -- which for a slot already in the past is a no-op that matters to nobody.
  update booking_items set state = 'missed' where id = p_item_id;

  return query select true, 'Marked as a no-show.'::text;
end $$;


--
-- Name: mark_partner_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_partner_notifications_read() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partner_notifications
  set read_at = now()
  where partner_id = v_partner and read_at is null;
end $$;


--
-- Name: mark_support_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_support_read() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    return;
  end if;

  update support_messages
  set read_at = now()
  where partner_id = v_partner and sender = 'admin' and read_at is null;

  update partner_notifications
  set read_at = now()
  where partner_id = v_partner and kind = 'support' and read_at is null;
end $$;


--
-- Name: mark_traveller_messages_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_traveller_messages_read(p_item_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update booking_messages m
  set read_at = now()
  where m.item_id = p_item_id
    and m.sender = 'partner'
    and m.read_at is null
    and exists (
      select 1 from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = m.item_id and b.user_id = v_user
    );
end $$;


--
-- Name: my_owned_partner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_owned_partner() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select partner_id from partner_users
  where user_id = auth.uid() and role = 'owner'
  limit 1;
$$;


--
-- Name: my_pending_invites(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_pending_invites() RETURNS TABLE(invite_id uuid, partner_name text, role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select pi.id, p.name, pi.role
  from partner_invites pi
  join partners p on p.id = pi.partner_id
  where pi.accepted_at is null
    and lower(pi.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;


--
-- Name: new_ref_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.new_ref_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'AG-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where ref_code = candidate);
  end loop;
  return candidate;
end $$;


--
-- Name: normalise_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_code(p_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select upper(
    regexp_replace(
      -- keep only the last path segment if a whole URL was scanned
      regexp_replace(coalesce(p_code, ''), '^.*/', ''),
      '[^A-Za-z0-9-]', '', 'g'
    )
  )
$$;


--
-- Name: notify_partner_of_booking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_partner_of_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_title text;
  v_when  text;
  v_party text;
begin
  v_party := case
    when coalesce(new.kind, old.kind) = 'table'
      then 'Table for ' || coalesce(new.party, old.party)
    when coalesce(new.kind, old.kind) = 'ferry'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' adult' else ' adults' end
    when coalesce(new.kind, old.kind) = 'trip'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' seat' else ' seats' end
    else coalesce(new.party, old.party)
         || case when coalesce(new.party, old.party) = 1 then ' guest' else ' guests' end
  end;

  if TG_OP = 'INSERT' then
    if partner_wants_notification(new.partner_id, 'booking_new') then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_new',
        case when new.state = 'pending'
          then 'New booking — needs your confirmation'
          else 'New booking' end,
        v_title || ' · ' || v_when || ' · ' || v_party,
        new.id
      );
    end if;
    return null;
  end if;

  if TG_OP = 'UPDATE' and old.state is distinct from new.state then
    if new.state = 'refunded'
       and new.cancelled_note is not null
       and coalesce(old.cancelled_note, '') is distinct from new.cancelled_note
       and partner_wants_notification(new.partner_id, 'booking_cancelled') then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_cancelled',
        'Booking cancelled by Andaman Go',
        v_title || ' · ' || v_when || ' — ' || new.cancelled_note,
        new.id
      );

    elsif new.state = 'disrupted'
       and partner_wants_notification(new.partner_id, 'booking_disrupted') then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_disrupted',
        'Booking disrupted — weather',
        v_title || ' · ' || v_when || ' · ' || v_party,
        new.id
      );
    end if;

    return null;
  end if;

  return null;
end $$;


--
-- Name: notify_partner_of_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_partner_of_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_title text;
begin
  if new.sender <> 'traveller' then
    return null;
  end if;

  if not partner_wants_notification(new.partner_id, 'booking_message') then
    return null;
  end if;

  select coalesce(subject_title(i.kind, i.subject_id), 'A booking')
  into v_title
  from booking_items i where i.id = new.item_id;

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'booking_message',
    'New message from a traveller',
    coalesce(v_title, 'A booking') || ' — ' ||
      case when length(new.body) > 90 then left(new.body, 90) || '…' else new.body end,
    new.item_id
  );

  return null;
end $$;


--
-- Name: notify_partner_of_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_partner_of_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_title text;
begin
  -- Only a brand-new review, not an edit.
  if TG_OP <> 'INSERT' then
    return null;
  end if;

  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A listing');

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'review',
    new.rating || '★ review',
    v_title || (case when new.body is not null then ' — ' ||
      (case when length(new.body) > 90 then left(new.body, 90) || '…' else new.body end)
      else '' end),
    new.item_id
  );

  return null;
end $$;


--
-- Name: notify_partner_of_support(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_partner_of_support() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.sender <> 'admin' then
    return null;
  end if;

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'support',
    'Andaman Go replied',
    case when length(new.body) > 100 then left(new.body, 100) || '…' else new.body end,
    null
  );

  return null;
end $$;


--
-- Name: partner_address(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_address(p_partner_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select address from partners where id = p_partner_id
$$;


--
-- Name: partner_cancel_booking_item(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_cancel_booking_item(p_item_id uuid, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner  uuid;
  v_state    text;
  v_paid     int;
  v_starts   timestamptz;
  v_kind     text;
  v_subject  uuid;
  v_title    text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason — the traveller sees this.'::text;
    return;
  end if;

  select i.state, i.paid_online_paise, i.starts_at, i.kind, i.subject_id
    into v_state, v_paid, v_starts, v_kind, v_subject
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  -- The operator backing out means the traveller is made whole — everything
  -- they paid online comes back. sync_availability() (004) reopens the slot
  -- off the state change without needing to know an operator did this.
  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason),
      cancelled_at = now()
  where id = p_item_id;

  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'You cancelled a booking',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, 'Cancelled and refunded.'::text;
end $$;


--
-- Name: partner_maps_url(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_maps_url(p_partner_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select maps_url from partners where id = p_partner_id
$$;


--
-- Name: partner_name(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_name(p_partner_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select name from partners where id = p_partner_id
$$;


--
-- Name: partner_phone(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_phone(p_partner_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select contact_phone from partners where id = p_partner_id
$$;


--
-- Name: partner_photo_path(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_photo_path(p_partner_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select cover_photo_path from partners where id = p_partner_id
$$;


--
-- Name: partner_send_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_send_message(p_item_id uuid, p_body text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_booking uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id into v_booking
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'partner', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;


--
-- Name: partner_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_team() RETURNS TABLE(member_id uuid, email text, role text, joined_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select pu.user_id, u.email, pu.role, pu.created_at
  from partner_users pu
  join auth.users u on u.id = pu.user_id
  where pu.partner_id = my_owned_partner()
  order by (pu.role <> 'owner'), pu.created_at;
$$;


--
-- Name: partner_wants_notification(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_wants_notification(p_partner_id uuid, p_kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case p_kind
    when 'booking_new' then
      coalesce((select notify_new_booking from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_cancelled' then
      coalesce((select notify_cancellation from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_disrupted' then
      coalesce((select notify_cancellation from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_message' then
      coalesce((select notify_message from partner_notification_prefs where partner_id = p_partner_id), true)
    else true
  end
$$;


--
-- Name: recompute_listing_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_listing_rating() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  end if;

  return null;
end $$;


--
-- Name: record_listing_view(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_listing_view(p_kind text, p_subject text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    else
      return;
  end case;

  if v_subject is null then
    return;
  end if;

  insert into listing_views (kind, subject_id, partner_id)
  values (p_kind, v_subject, v_partner);
end $$;


--
-- Name: redeem_booking(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_booking(p_code text) RETURNS TABLE(ok boolean, already boolean, message text, ref_code text, kind text, title text, party integer, redeemed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner  uuid;
  v_code     text := normalise_code(p_code);
  -- Plain columns rather than a rowtype: plpgsql will not let a record share
  -- an INTO list with other variables, and the ref code lives on the booking.
  v_item_id  uuid;
  v_kind     text;
  v_subject  uuid;
  v_party    int;
  v_when     timestamptz;
  v_ref      text;
  v_title    text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.id, i.kind, i.subject_id, i.party, i.redeemed_at, b.ref_code
    into v_item_id, v_kind, v_subject, v_party, v_when, v_ref
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.partner_id = v_partner
    and (normalise_code(i.ticket_code) = v_code or normalise_code(b.ref_code) = v_code)
    and i.state <> 'refunded'
  order by (i.redeemed_at is not null), i.starts_at
  limit 1
  for update of i;

  if v_item_id is null then
    return query select false, false,
      'No booking here for that code. Check the reference, or ask them to open the app.'::text,
      null::text, null::text, null::text, null::int, null::timestamptz;
    return;
  end if;

  v_title := subject_title(v_kind, v_subject);

  -- Already done. Not an error — this is the answer a replayed offline scan
  -- and a genuine double-scan both deserve.
  if v_when is not null then
    return query select true, true,
      format('Already checked in at %s.',
             to_char(v_when at time zone 'Asia/Kolkata', 'HH12:MI AM'))::text,
      v_ref, v_kind, v_title, v_party, v_when;
    return;
  end if;

  update booking_items
  set redeemed_at = now(),
      redeemed_by = v_partner,
      state       = 'completed'
  where id = v_item_id
  returning booking_items.redeemed_at into v_when;

  return query select true, false,
    format('Checked in — %s for %s.', v_title, v_party)::text,
    v_ref, v_kind, v_title, v_party, v_when;
end $$;


--
-- Name: refund_booking(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_booking(p_ref_code text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user  uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update booking_items i
  set state = 'refunded'
  from bookings b
  where b.id = i.booking_id
    and b.ref_code = p_ref_code
    and b.user_id = v_user
    and i.state in ('pending', 'confirmed', 'disrupted');

  get diagnostics v_count = row_count;
  return v_count;
end $$;


--
-- Name: register_partner(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text, partner_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_existing uuid;
  v_slug text;
  v_id uuid;
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


--
-- Name: remove_partner_staff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_partner_staff(p_user_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can do that.'::text;
    return;
  end if;

  if p_user_id = auth.uid() then
    return query select false, 'You can''t remove yourself.'::text;
    return;
  end if;

  delete from partner_users
  where user_id = p_user_id and partner_id = v_partner and role = 'staff';

  if not found then
    return query select false, 'They''re not a staff member on your team.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end $$;


--
-- Name: rental_load_on(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rental_load_on(p_date date) RETURNS TABLE(variant_id uuid, out_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select i.variant_id, count(*) as out_count
  from booking_items i
  cross join lateral generate_series(0, i.units - 1) as g(n)
  where i.kind = 'rental'
    and i.variant_id is not null
    and i.state in ('pending', 'confirmed', 'disrupted', 'completed')
    and ((i.starts_at at time zone 'Asia/Kolkata')::date + g.n) = p_date
  group by i.variant_id;
$$;


--
-- Name: reopen_partner_date(text, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  delete from listing_closures
  where kind = p_kind
    and subject_id = p_subject_id
    and on_date = p_on_date
    and partner_id = v_partner;

  return query select true, 'Reopened.'::text;
end $$;


--
-- Name: reopen_partner_date_impl(text, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  -- partner_id in the WHERE is what stops a partner reopening someone else's
  -- closure by guessing a subject_id. No row deleted is still a success —
  -- the date is open either way.
  delete from listing_closures
  where kind = p_kind
    and subject_id = p_subject_id
    and on_date = p_on_date
    and partner_id = v_partner;

  return query select true, 'Reopened.'::text;
end $$;


--
-- Name: reply_to_review(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_to_review(p_review_id uuid, p_reply text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_owner   uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select partner_id into v_owner from reviews where id = p_review_id;
  if v_owner is null or v_owner <> v_partner then
    return query select false, 'Review not found.'::text;
    return;
  end if;

  if coalesce(trim(p_reply), '') = '' then
    update reviews set reply = null, replied_at = null where id = p_review_id;
    return query select true, 'Reply removed.'::text;
    return;
  end if;

  update reviews
  set reply = trim(p_reply), replied_at = now()
  where id = p_review_id;

  return query select true, 'Reply posted.'::text;
end $$;


--
-- Name: reply_to_review_impl(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_to_review_impl(p_review_id uuid, p_reply text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_owner   uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select partner_id into v_owner from reviews where id = p_review_id;
  if v_owner is null or v_owner <> v_partner then
    return query select false, 'Review not found.'::text;
    return;
  end if;

  if coalesce(trim(p_reply), '') = '' then
    update reviews set reply = null, replied_at = null where id = p_review_id;
    return query select true, 'Reply removed.'::text;
    return;
  end if;

  update reviews
  set reply = trim(p_reply), replied_at = now()
  where id = p_review_id;

  return query select true, 'Reply posted.'::text;
end $$;


--
-- Name: resubmit_partner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resubmit_partner() RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from resubmit_partner_impl();
end $$;


--
-- Name: resubmit_partner_impl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resubmit_partner_impl() RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_status text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select status into v_status from partners where id = v_partner;
  if v_status is distinct from 'rejected' then
    return query select false, 'Nothing to resubmit.'::text;
    return;
  end if;

  update partners set status = 'pending', rejection_reason = null where id = v_partner;
  return query select true, 'Sent back for review.'::text;
end;
$$;


--
-- Name: resubmit_partner_listing(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resubmit_partner_listing(p_kind text, p_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from resubmit_partner_listing_impl(p_kind, p_id);
end $$;


--
-- Name: resubmit_partner_listing_impl(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resubmit_partner_listing_impl(p_kind text, p_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: revoke_partner_invite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_partner_invite(p_invite_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can do that.'::text;
    return;
  end if;

  delete from partner_invites
  where id = p_invite_id and partner_id = v_partner and accepted_at is null;

  return query select true, 'Invite withdrawn.'::text;
end $$;


--
-- Name: save_event_guests(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_event_guests(p_ref_code text, p_guests jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item     uuid;
  v_party    int;
  v_ticketed int;
  g          jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party into v_item, v_party
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'event'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That event booking could not be found.'::text;
    return;
  end if;

  if p_guests is null or jsonb_typeof(p_guests) <> 'array' or jsonb_array_length(p_guests) < 1 then
    return query select false, 'Add everyone who is coming.'::text;
    return;
  end if;

  v_ticketed := 0;
  for g in select * from jsonb_array_elements(p_guests) loop
    if coalesce(trim(g->>'fullName'), '') = '' then
      return query select false, 'Every guest needs a name.'::text;
      return;
    end if;
    if (g->>'age') is null or (g->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every guest.'::text;
      return;
    end if;
    if (g->>'age')::int > 3 then
      v_ticketed := v_ticketed + 1;
    end if;
  end loop;

  if v_ticketed <> v_party then
    return query select false,
      format('%s of your guests need a ticket, but %s %s booked. Kids 3 and under don''t need one.',
             v_ticketed, v_party, case when v_party = 1 then 'was' else 'were' end)::text;
    return;
  end if;

  delete from event_guests where booking_item_id = v_item;

  insert into event_guests (booking_item_id, full_name, age)
  select v_item, trim(g->>'fullName'), (g->>'age')::int
  from jsonb_array_elements(p_guests) as g;

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: save_ferry_passengers(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_ferry_passengers(p_ref_code text, p_passengers jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item   uuid;
  v_party  int;
  p        jsonb;
  v_nat    text;
  v_idtype text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party into v_item, v_party
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'ferry'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That ferry booking could not be found.'::text;
    return;
  end if;

  if p_passengers is null or jsonb_typeof(p_passengers) <> 'array'
     or jsonb_array_length(p_passengers) <> v_party then
    return query select false, format('Enter details for all %s passengers.', v_party)::text;
    return;
  end if;

  for p in select * from jsonb_array_elements(p_passengers) loop
    v_nat    := coalesce(nullif(trim(p->>'nationality'), ''), 'Indian');
    v_idtype := lower(coalesce(p->>'idType', ''));

    if coalesce(trim(p->>'fullName'), '') = '' then
      return query select false, 'Every passenger needs a full name.'::text;
      return;
    end if;
    if (p->>'age') is null or (p->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every passenger.'::text;
      return;
    end if;
    if lower(coalesce(p->>'gender', '')) not in ('male','female','other') then
      return query select false, 'Choose a gender for every passenger.'::text;
      return;
    end if;
    if v_idtype not in ('aadhaar','passport','driving-licence') then
      return query select false, 'Choose an ID type for every passenger.'::text;
      return;
    end if;
    if v_nat <> 'Indian' and v_idtype <> 'passport' then
      return query select false, 'A foreign national must travel on a passport.'::text;
      return;
    end if;
    if coalesce(trim(p->>'idNumber'), '') = '' then
      return query select false, 'Enter the ID number for every passenger.'::text;
      return;
    end if;
  end loop;

  delete from ferry_passengers where booking_item_id = v_item;

  insert into ferry_passengers (booking_item_id, full_name, age, gender, nationality, id_type, id_number)
  select
    v_item,
    trim(p->>'fullName'),
    (p->>'age')::int,
    lower(p->>'gender'),
    coalesce(nullif(trim(p->>'nationality'), ''), 'Indian'),
    lower(p->>'idType'),
    trim(p->>'idNumber')
  from jsonb_array_elements(p_passengers) as p;

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: save_trip_travellers(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_trip_travellers(p_ref_code text, p_travellers jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item  uuid;
  v_party int;
  t       jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party into v_item, v_party
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'trip'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That trip booking could not be found.'::text;
    return;
  end if;

  if p_travellers is null or jsonb_typeof(p_travellers) <> 'array'
     or jsonb_array_length(p_travellers) <> v_party then
    return query select false, format('Enter details for all %s travellers.', v_party)::text;
    return;
  end if;

  for t in select * from jsonb_array_elements(p_travellers) loop
    if coalesce(trim(t->>'fullName'), '') = '' then
      return query select false, 'Every traveller needs a name.'::text;
      return;
    end if;
    if (t->>'age') is null or (t->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every traveller.'::text;
      return;
    end if;
  end loop;

  delete from trip_travellers where booking_item_id = v_item;

  insert into trip_travellers (booking_item_id, full_name, age)
  select v_item, trim(t->>'fullName'), (t->>'age')::int
  from jsonb_array_elements(p_travellers) as t;

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: send_support_message(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_support_message(p_body text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 4000 then
    return query select false, 'That message is too long.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (v_partner, 'open', now())
  on conflict (partner_id) do update set status = 'open', updated_at = now();

  insert into support_messages (partner_id, sender, body)
  values (v_partner, 'partner', trim(p_body));

  return query select true, 'Sent. Andaman Go will get back to you here.'::text;
end $$;


--
-- Name: set_car_routes(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_car_routes(p_cab_id uuid, p_routes jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_row     jsonb;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from cabs where id = p_cab_id and partner_id = v_partner) then
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


--
-- Name: set_category_payment(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_category_payment(p_kind text, p_mode text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_commission_rate(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_commission_rate(p_kind text, p_bps integer) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_listing_photos(text, uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_listing_photos(p_kind text, p_id uuid, p_paths text[]) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
    when 'ferry' then 'sailings' else null end;
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
end $_$;


--
-- Name: set_my_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_email(p_email text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user  uuid := auth.uid();
  v_clean text := lower(trim(coalesce(p_email, '')));
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if v_clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address' using errcode = '22023';
  end if;

  insert into traveller_profiles (user_id, email)
  values (v_user, v_clean)
  on conflict (user_id) do update set email = excluded.email;

  -- Backfill this person's bookings that never got an email.
  update bookings
  set contact_email = v_clean
  where user_id = v_user and contact_email is null;

  return v_clean;
end $_$;


--
-- Name: set_my_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_phone(p_phone text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user  uuid := auth.uid();
  v_clean text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Keep the digits and a leading +. An Indian mobile typed without a country
  -- code is the common case, so give it one rather than rejecting it.
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a phone number' using errcode = '22023';
  end if;

  insert into traveller_profiles (user_id, phone)
  values (v_user, v_clean)
  on conflict (user_id) do update set phone = excluded.phone;

  -- Backfill this person's bookings that never got a number.
  update bookings
  set contact_phone = v_clean
  where user_id = v_user and contact_phone is null;

  return v_clean;
end $_$;


--
-- Name: set_partner_activity_schedule(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_activity_schedule_impl(p_activity_id, p_slots);
end $$;


--
-- Name: set_partner_activity_schedule_impl(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_activity_schedule_impl(p_activity_id uuid, p_slots jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_capacity int;
  v_days int[];
  v_seen_times int[] := '{}';
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from activities where id = p_activity_id and partner_id = v_partner) then
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
end;
$$;


--
-- Name: set_partner_contact_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_contact_phone(p_phone text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_partner uuid;
  v_clean   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  -- Same cleaning as set_my_phone (007): keep digits and a leading +, assume
  -- India when there's no country code.
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

  update partners set contact_phone = nullif(v_clean, '') where id = v_partner;

  return query select true, 'Saved.'::text;
end $_$;


--
-- Name: set_partner_contact_phone_impl(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_contact_phone_impl(p_phone text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_partner uuid;
  v_clean   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  -- Same cleaning as set_my_phone (007): keep digits and a leading +, assume
  -- India when there's no country code.
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

  update partners set contact_phone = nullif(v_clean, '') where id = v_partner;

  return query select true, 'Saved.'::text;
end $_$;


--
-- Name: set_partner_notification_prefs(boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  insert into partner_notification_prefs
    (partner_id, notify_new_booking, notify_cancellation, notify_message, updated_at)
  values
    (v_partner, coalesce(p_new_booking, true), coalesce(p_cancellation, true),
     coalesce(p_message, true), now())
  on conflict (partner_id) do update set
    notify_new_booking  = excluded.notify_new_booking,
    notify_cancellation = excluded.notify_cancellation,
    notify_message      = excluded.notify_message,
    updated_at          = now();

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: set_partner_notification_prefs_impl(boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_notification_prefs_impl(p_new_booking boolean, p_cancellation boolean, p_message boolean) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  insert into partner_notification_prefs
    (partner_id, notify_new_booking, notify_cancellation, notify_message, updated_at)
  values
    (v_partner, coalesce(p_new_booking, true), coalesce(p_cancellation, true),
     coalesce(p_message, true), now())
  on conflict (partner_id) do update set
    notify_new_booking  = excluded.notify_new_booking,
    notify_cancellation = excluded.notify_cancellation,
    notify_message      = excluded.notify_message,
    updated_at          = now();

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: set_partner_rental_hours(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_rental_hours(p_slots jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner   uuid;
  v_slot      jsonb;
  v_count     int;
  v_dow       int;
  v_open      int;
  v_close     int;
  v_seen_dows int[] := '{}';
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from partners where id = v_partner and kind = 'rental') then
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

  delete from rental_hours where partner_id = v_partner;

  insert into rental_hours (partner_id, dow, open_mins, close_mins)
  select v_partner, (s->>'dow')::int, (s->>'open_mins')::int, (s->>'close_mins')::int
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Opening hours saved.'::text;
end $$;


--
-- Name: set_partner_restaurant_tables(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_restaurant_tables_impl(p_restaurant_id, p_slots);
end $$;


--
-- Name: set_partner_restaurant_tables_impl(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_partner_restaurant_tables_impl(p_restaurant_id uuid, p_slots jsonb) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_table_count int;
  v_seats_per_table int;
  v_seen_times int[] := '{}';
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id and partner_id = v_partner) then
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
end;
$$;


--
-- Name: set_payout_account(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_partner uuid;
  v_ifsc    text := nullif(upper(trim(coalesce(p_ifsc, ''))), '');
  v_upi     text := nullif(lower(trim(coalesce(p_upi_id, ''))), '');
  v_acct    text := nullif(regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g'), '');
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    return query select false, 'That IFSC code doesn''t look right.'::text;
    return;
  end if;
  if v_upi is not null and v_upi !~ '^[a-z0-9._-]+@[a-z0-9.-]+$' then
    return query select false, 'That UPI ID doesn''t look right.'::text;
    return;
  end if;

  insert into payout_accounts (partner_id, account_name, account_number, ifsc, upi_id, updated_at)
  values (v_partner, nullif(trim(p_account_name), ''), v_acct, v_ifsc, v_upi, now())
  on conflict (partner_id) do update set
    account_name   = excluded.account_name,
    account_number = excluded.account_number,
    ifsc           = excluded.ifsc,
    upi_id         = excluded.upi_id,
    updated_at     = now();

  return query select true, 'Saved.'::text;
end $_$;


--
-- Name: set_payout_account_impl(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_payout_account_impl(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_partner uuid;
  v_ifsc    text := nullif(upper(trim(coalesce(p_ifsc, ''))), '');
  v_upi     text := nullif(lower(trim(coalesce(p_upi_id, ''))), '');
  v_acct    text := nullif(regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g'), '');
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    return query select false, 'That IFSC code doesn''t look right.'::text;
    return;
  end if;
  if v_upi is not null and v_upi !~ '^[a-z0-9._-]+@[a-z0-9.-]+$' then
    return query select false, 'That UPI ID doesn''t look right.'::text;
    return;
  end if;

  insert into payout_accounts (partner_id, account_name, account_number, ifsc, upi_id, updated_at)
  values (v_partner, nullif(trim(p_account_name), ''), v_acct, v_ifsc, v_upi, now())
  on conflict (partner_id) do update set
    account_name   = excluded.account_name,
    account_number = excluded.account_number,
    ifsc           = excluded.ifsc,
    upi_id         = excluded.upi_id,
    updated_at     = now();

  return query select true, 'Saved.'::text;
end $_$;


--
-- Name: set_vehicle_security_deposit(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_paise is null or p_paise < 0 then
    return query select false, 'The deposit has to be zero or more.'::text;
    return;
  end if;

  update vehicles set security_deposit_paise = p_paise
  where id = p_vehicle_id and partner_id = v_partner;

  if not found then
    return query select false, 'That vehicle no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;


--
-- Name: subject_title(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subject_title(p_kind text, p_subject_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  end
$$;


--
-- Name: sync_availability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_availability() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_kind       text;
  v_subject_id uuid;
  v_starts_at  timestamptz;
  v_total      int;
begin
  v_kind       := coalesce(new.kind, old.kind);
  v_subject_id := coalesce(new.subject_id, old.subject_id);
  v_starts_at  := coalesce(new.starts_at, old.starts_at);

  select coalesce(sum(party), 0) into v_total
  from booking_items
  where kind = v_kind
    and subject_id = v_subject_id
    and starts_at = v_starts_at
    and state in ('pending', 'confirmed', 'disrupted', 'completed');

  insert into availability (kind, subject_id, starts_at, baseline, taken)
  values (v_kind, v_subject_id, v_starts_at, 0, v_total)
  on conflict (kind, subject_id, starts_at)
  do update set taken = availability.baseline + v_total;

  return null;
end $$;


--
-- Name: traveller_send_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.traveller_send_message(p_item_id uuid, p_body text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user    uuid := auth.uid();
  v_booking uuid;
  v_partner uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id, i.partner_id into v_booking, v_partner
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'traveller', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;


--
-- Name: undo_redeem_booking_item(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_redeem_booking_item(p_item_id uuid) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner  uuid;
  v_state    text;
  v_redeemed timestamptz;
  v_owner    uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select state, redeemed_at, partner_id into v_state, v_redeemed, v_owner
  from booking_items where id = p_item_id
  for update;

  if v_owner is null or v_owner <> v_partner then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_state <> 'completed' or v_redeemed is null then
    return query select false, 'This booking hasn''t been checked in.'::text;
    return;
  end if;

  if (v_redeemed at time zone 'Asia/Kolkata')::date <> (now() at time zone 'Asia/Kolkata')::date then
    return query select false, 'Check-ins can only be undone the same day.'::text;
    return;
  end if;

  update booking_items
  set state = 'confirmed', redeemed_at = null, redeemed_by = null
  where id = p_item_id;

  return query select true, 'Check-in undone.'::text;
end $$;


--
-- Name: unique_slug(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unique_slug(p_base text, p_table text) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: update_partner_activity(uuid, text, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_activity(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_activity_impl(
    p_id, p_name, p_summary, p_about, p_price_paise, p_photo_path
  );
end $$;


--
-- Name: update_partner_activity_impl(uuid, text, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_activity_impl(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from activities where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

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
    price_paise = p_price_paise,
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: update_partner_car(uuid, text, text, integer, integer, boolean, text, text, integer, integer, integer, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer DEFAULT 0, p_night_surcharge_paise integer DEFAULT 0, p_per_km_paise integer DEFAULT 0, p_per_min_paise integer DEFAULT 0, p_meta text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

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

  select is_listed into v_was_listed from cabs where id = p_id and partner_id = v_partner;
  if v_was_listed is null then
    return query select false, 'That car no longer exists.'::text;
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
    meta = coalesce(trim(p_meta), ''),
    photo_path = coalesce(p_photo_path, photo_path),
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then rejection_reason else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end $$;


--
-- Name: update_partner_event(uuid, text, text, text, date, integer, integer, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text DEFAULT 'all-ages'::text, p_performer text DEFAULT NULL::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;

  select is_listed, genre into v_was_listed, v_genre
  from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
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


--
-- Name: update_partner_event_impl(uuid, text, text, text, date, integer, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_event_impl(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
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
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a valid start time.'::text;
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

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(trim(p_area), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: update_partner_profile(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_profile(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_profile_impl(
    p_address, p_maps_url, p_cover_photo_path, p_license_number, p_license_doc_path
  );
end $$;


--
-- Name: update_partner_profile_impl(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_profile_impl(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: update_partner_restaurant(uuid, text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_restaurant(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_restaurant_impl(
    p_id, p_name, p_area, p_price_tier, p_blurb, p_about, p_photo_path
  );
end $$;


--
-- Name: update_partner_restaurant_impl(uuid, text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_restaurant_impl(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from restaurants where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the restaurant a name.'::text;
    return;
  end if;
  if p_price_tier is null or p_price_tier not between 1 and 3 then
    return query select false, 'Choose a price range.'::text;
    return;
  end if;

  update restaurants set
    name = trim(p_name),
    area = coalesce(trim(p_area), ''),
    price_tier = p_price_tier,
    blurb = coalesce(trim(p_blurb), ''),
    about = coalesce(trim(p_about), ''),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: update_partner_sailing(uuid, text, integer, integer, integer, integer, integer[], text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_sailing(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text DEFAULT 'plain'::text, p_info text DEFAULT ''::text, p_info_warn boolean DEFAULT false, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_sailing_impl(
    p_id, p_style_label, p_dep_mins, p_duration_mins, p_fare_paise, p_capacity,
    p_days_of_week, p_style_tone, p_info, p_info_warn, p_photo_path
  );
end $$;


--
-- Name: update_partner_sailing_impl(uuid, text, integer, integer, integer, integer, integer[], text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_sailing_impl(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from sailings where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if coalesce(trim(p_style_label), '') = '' then
    return query select false, 'Give the ticket class a name.'::text;
    return;
  end if;
  if coalesce(p_style_tone, 'plain') not in ('good', 'warm', 'plain') then
    return query select false, 'Choose a valid badge style.'::text;
    return;
  end if;
  if p_dep_mins is null or p_dep_mins not between 0 and 1439 then
    return query select false, 'Choose a valid departure time.'::text;
    return;
  end if;
  if p_duration_mins is null or p_duration_mins < 1 then
    return query select false, 'Enter a valid journey time.'::text;
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

  update sailings set
    style_label = trim(p_style_label),
    dep_mins = p_dep_mins,
    duration_mins = p_duration_mins,
    fare_paise = p_fare_paise,
    capacity = p_capacity,
    days_of_week = coalesce(p_days_of_week, '{0,1,2,3,4,5,6}'),
    style_tone = coalesce(p_style_tone, 'plain'),
    info = coalesce(trim(p_info), ''),
    info_warn = coalesce(p_info_warn, false),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: update_partner_trip(uuid, text, text, text, text, integer[], integer, text, integer, integer, text, text[], text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[] DEFAULT '{}'::text[], p_bring_list text[] DEFAULT '{}'::text[], p_meet_point text DEFAULT ''::text, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: update_partner_trip_impl(uuid, text, text, text, text, integer[], integer, integer, integer, integer, text, text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_trip_impl(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from trips where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the trip a host name.'::text;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Add a meeting point.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;
  if p_deposit_paise is null or p_deposit_paise < 0 or p_deposit_paise > p_price_paise then
    return query select false, 'Deposit must be between 0 and the full price.'::text;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Minimum seats must be between 1 and the total seats.'::text;
    return;
  end if;

  update trips set
    title = trim(p_title),
    host_name = trim(p_host_name),
    host_since = coalesce(nullif(trim(p_host_since), ''), 'New host'),
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
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: update_partner_vehicle(uuid, text, integer, integer, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_vehicle(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text DEFAULT NULL::text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_vehicle_impl(
    p_id, p_model, p_rate_paise, p_seats, p_meta, p_units, p_photo_path
  );
end $$;


--
-- Name: update_partner_vehicle_impl(uuid, text, integer, integer, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_vehicle_impl(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_was_listed boolean;
  v_seats int;
  v_units int;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select is_listed into v_was_listed from vehicles where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the vehicle a model name.'::text;
    return;
  end if;
  if p_rate_paise is null or p_rate_paise < 0 then
    return query select false, 'Enter a valid rate.'::text;
    return;
  end if;

  v_seats := greatest(coalesce(p_seats, 2), 1);
  v_units := greatest(coalesce(p_units, 1), 1);

  update vehicles set
    model = trim(p_model),
    rate_paise = p_rate_paise,
    seats = v_seats,
    meta = coalesce(trim(p_meta), ''),
    units = v_units,
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then null else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true,
      'Saved. Since this was already live, it goes back to Andaman Go for a quick recheck before travellers see it again.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


--
-- Name: weather_close_partner(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.weather_close_partner(p_on_date date, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_count   int;
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

  insert into listing_closures (partner_id, kind, subject_id, on_date, reason)
  select v_partner, 'activity', a.id, p_on_date, trim(p_reason)
    from activities a where a.partner_id = v_partner
  union all
  select v_partner, 'trip', t.id, p_on_date, trim(p_reason)
    from trips t where t.partner_id = v_partner
  on conflict (kind, subject_id, on_date)
  do update set reason = excluded.reason;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return query select false, 'You have no activities or trips to close.'::text;
    return;
  end if;

  return query select true,
    format('Closed %s listing%s.', v_count, case when v_count = 1 then '' else 's' end)::text;
end $$;


--
-- Name: weather_close_partner_impl(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.weather_close_partner_impl(p_on_date date, p_reason text) RETURNS TABLE(ok boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_partner uuid;
  v_count   int;
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

  insert into listing_closures (partner_id, kind, subject_id, on_date, reason)
  select v_partner, 'activity', a.id, p_on_date, trim(p_reason)
    from activities a where a.partner_id = v_partner
  union all
  select v_partner, 'trip', t.id, p_on_date, trim(p_reason)
    from trips t where t.partner_id = v_partner
  on conflict (kind, subject_id, on_date)
  do update set reason = excluded.reason;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return query select false, 'You have no activities or trips to close.'::text;
    return;
  end if;

  return query select true,
    format('Closed %s listing%s.', v_count, case when v_count = 1 then '' else 's' end)::text;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    partner_id uuid NOT NULL,
    island_slug text NOT NULL,
    category text NOT NULL,
    mark text NOT NULL,
    name text NOT NULL,
    summary text NOT NULL,
    about text NOT NULL,
    price_paise integer NOT NULL,
    rating numeric(2,1) NOT NULL,
    reviews integer DEFAULT 0 NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_path text,
    rejection_reason text,
    seed_rating numeric(2,1),
    seed_reviews integer DEFAULT 0 NOT NULL,
    CONSTRAINT activities_category_check CHECK ((category = ANY (ARRAY['scuba'::text, 'seawalk'::text, 'snorkel'::text, 'water'::text]))),
    CONSTRAINT activities_price_paise_check CHECK ((price_paise >= 0))
);


--
-- Name: activity_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    time_mins integer NOT NULL,
    capacity integer NOT NULL,
    days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    closed_reason text,
    CONSTRAINT activity_schedule_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT activity_schedule_time_mins_check CHECK (((time_mins >= 0) AND (time_mins <= 1439)))
);


--
-- Name: booking_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    party integer NOT NULL,
    price_paise integer NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    ticket_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    redeemed_at timestamp with time zone,
    redeemed_by uuid,
    cancelled_note text,
    confirmed_at timestamp with time zone,
    pay_mode text DEFAULT 'full'::text NOT NULL,
    paid_online_paise integer DEFAULT 0 NOT NULL,
    balance_paise integer DEFAULT 0 NOT NULL,
    refunded_paise integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 1 NOT NULL,
    variant_id uuid,
    cab_id uuid,
    cancelled_at timestamp with time zone,
    CONSTRAINT booking_items_balance_paise_check CHECK ((balance_paise >= 0)),
    CONSTRAINT booking_items_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'ferry'::text, 'table'::text, 'event'::text, 'rental'::text, 'trip'::text, 'cab'::text]))),
    CONSTRAINT booking_items_paid_online_paise_check CHECK ((paid_online_paise >= 0)),
    CONSTRAINT booking_items_party_check CHECK ((party > 0)),
    CONSTRAINT booking_items_pay_mode_check CHECK ((pay_mode = ANY (ARRAY['full'::text, 'deposit'::text, 'none'::text]))),
    CONSTRAINT booking_items_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT booking_items_refunded_paise_check CHECK ((refunded_paise >= 0)),
    CONSTRAINT booking_items_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'confirmed'::text, 'disrupted'::text, 'completed'::text, 'missed'::text, 'refunded'::text]))),
    CONSTRAINT booking_items_units_check CHECK ((units > 0))
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref_code text NOT NULL,
    user_id uuid,
    island_slug text NOT NULL,
    on_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_phone text,
    contact_email text
);


--
-- Name: commission_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_rates (
    kind text NOT NULL,
    bps integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_rates_bps_check CHECK (((bps >= 0) AND (bps <= 10000))),
    CONSTRAINT commission_rates_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'ferry'::text, 'table'::text, 'event'::text, 'trip'::text, 'rental'::text, 'cab'::text])))
);


--
-- Name: partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    island_slug text NOT NULL,
    contact_phone text,
    rating numeric(2,1),
    reviews integer DEFAULT 0 NOT NULL,
    distance_label text,
    blurb text,
    status text DEFAULT 'approved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    credential text,
    address text,
    maps_url text,
    cover_photo_path text,
    license_number text,
    license_doc_path text,
    rejection_reason text,
    seed_rating numeric(2,1),
    seed_reviews integer DEFAULT 0 NOT NULL,
    CONSTRAINT partners_kind_check CHECK ((kind = ANY (ARRAY['dive'::text, 'ferry'::text, 'restaurant'::text, 'rental'::text, 'venue'::text, 'host'::text, 'cab'::text]))),
    CONSTRAINT partners_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text])))
);


--
-- Name: admin_bookings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_bookings WITH (security_invoker='on') AS
 SELECT i.id AS item_id,
    b.id AS booking_id,
    b.ref_code,
    i.partner_id,
    p.name AS partner_name,
    p.status AS partner_status,
    b.island_slug,
    i.kind,
    public.subject_title(i.kind, i.subject_id) AS title,
    i.starts_at,
    i.party,
    i.price_paise,
    i.state,
    i.ticket_code,
    i.redeemed_at,
    i.cancelled_note,
    b.contact_phone,
    b.contact_email,
    b.created_at AS booked_at,
    cr.bps AS commission_bps,
    i.pay_mode,
    i.paid_online_paise,
    i.balance_paise,
    i.refunded_paise,
    i.cancelled_at
   FROM (((public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
     JOIN public.partners p ON ((p.id = i.partner_id)))
     LEFT JOIN public.commission_rates cr ON ((cr.kind = i.kind)))
  WHERE public.is_admin();


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    user_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    rating integer NOT NULL,
    body text,
    reply text,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'table'::text, 'event'::text, 'trip'::text, 'rental'::text, 'cab'::text]))),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: admin_reviews; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_reviews WITH (security_invoker='on') AS
 SELECT r.id,
    r.partner_id,
    p.name AS partner_name,
    r.kind,
    r.subject_id,
    public.subject_title(r.kind, r.subject_id) AS listing_title,
    r.rating,
    r.body,
    r.reply,
    r.replied_at,
    r.created_at
   FROM (public.reviews r
     JOIN public.partners p ON ((p.id = r.partner_id)))
  WHERE public.is_admin();


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_sender_check CHECK ((sender = ANY (ARRAY['partner'::text, 'admin'::text])))
);


--
-- Name: support_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_threads (
    partner_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: admin_support_threads; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_support_threads WITH (security_invoker='on') AS
 SELECT st.partner_id,
    p.name AS partner_name,
    st.status,
    st.updated_at,
    ( SELECT count(*) AS count
           FROM public.support_messages m
          WHERE ((m.partner_id = st.partner_id) AND (m.sender = 'partner'::text) AND (m.read_at IS NULL))) AS partner_unread,
    ( SELECT m.body
           FROM public.support_messages m
          WHERE (m.partner_id = st.partner_id)
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_body,
    ( SELECT m.sender
           FROM public.support_messages m
          WHERE (m.partner_id = st.partner_id)
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_sender
   FROM (public.support_threads st
     JOIN public.partners p ON ((p.id = st.partner_id)))
  WHERE public.is_admin();


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability (
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    taken integer DEFAULT 0 NOT NULL,
    baseline integer DEFAULT 0 NOT NULL,
    CONSTRAINT availability_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'ferry'::text, 'table'::text, 'event'::text, 'rental'::text, 'trip'::text, 'cab'::text]))),
    CONSTRAINT availability_taken_check CHECK ((taken >= 0))
);


--
-- Name: booking_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_messages_sender_check CHECK ((sender = ANY (ARRAY['partner'::text, 'traveller'::text])))
);


--
-- Name: cab_places; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cab_places (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    island_slug text NOT NULL,
    label text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    is_airport boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: cab_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cab_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cab_id uuid NOT NULL,
    from_place_id uuid NOT NULL,
    to_place_id uuid NOT NULL,
    oneway_paise integer NOT NULL,
    roundtrip_paise integer NOT NULL,
    CONSTRAINT cab_routes_check CHECK ((from_place_id <> to_place_id)),
    CONSTRAINT cab_routes_oneway_paise_check CHECK ((oneway_paise >= 0)),
    CONSTRAINT cab_routes_roundtrip_paise_check CHECK ((roundtrip_paise >= 0))
);


--
-- Name: cab_trip_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cab_trip_details (
    item_id uuid NOT NULL,
    trip_type text NOT NULL,
    from_place_id uuid,
    to_place_id uuid,
    return_date date,
    days integer DEFAULT 1 NOT NULL,
    pickup_note text DEFAULT ''::text NOT NULL,
    CONSTRAINT cab_trip_details_days_check CHECK ((days > 0)),
    CONSTRAINT cab_trip_details_trip_type_check CHECK ((trip_type = ANY (ARRAY['oneway'::text, 'roundtrip'::text, 'fullday'::text])))
);


--
-- Name: cabs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    partner_id uuid NOT NULL,
    category text NOT NULL,
    model text NOT NULL,
    seats integer DEFAULT 4 NOT NULL,
    luggage integer DEFAULT 0 NOT NULL,
    ac boolean DEFAULT true NOT NULL,
    fuel text NOT NULL,
    board_number text,
    full_day_paise integer DEFAULT 0 NOT NULL,
    airport_surcharge_paise integer DEFAULT 0 NOT NULL,
    night_surcharge_paise integer DEFAULT 0 NOT NULL,
    per_km_paise integer DEFAULT 0 NOT NULL,
    per_min_paise integer DEFAULT 0 NOT NULL,
    meta text DEFAULT ''::text NOT NULL,
    photo_path text,
    is_listed boolean DEFAULT false NOT NULL,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cabs_airport_surcharge_paise_check CHECK ((airport_surcharge_paise >= 0)),
    CONSTRAINT cabs_category_check CHECK ((category = ANY (ARRAY['hatchback'::text, 'sedan'::text, 'suv'::text, 'tempo'::text]))),
    CONSTRAINT cabs_fuel_check CHECK ((fuel = ANY (ARRAY['ev'::text, 'petrol'::text, 'diesel'::text]))),
    CONSTRAINT cabs_full_day_paise_check CHECK ((full_day_paise >= 0)),
    CONSTRAINT cabs_luggage_check CHECK ((luggage >= 0)),
    CONSTRAINT cabs_night_surcharge_paise_check CHECK ((night_surcharge_paise >= 0)),
    CONSTRAINT cabs_per_km_paise_check CHECK ((per_km_paise >= 0)),
    CONSTRAINT cabs_per_min_paise_check CHECK ((per_min_paise >= 0)),
    CONSTRAINT cabs_seats_check CHECK ((seats > 0))
);


--
-- Name: category_payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_payment (
    kind text NOT NULL,
    mode text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_payment_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'ferry'::text, 'table'::text, 'event'::text, 'trip'::text, 'rental'::text, 'cab'::text]))),
    CONSTRAINT category_payment_mode_check CHECK ((mode = ANY (ARRAY['free'::text, 'full'::text, 'choice'::text, 'contact'::text])))
);


--
-- Name: event_guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_guests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_item_id uuid NOT NULL,
    full_name text NOT NULL,
    age integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_guests_age_check CHECK (((age >= 0) AND (age <= 120)))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    partner_id uuid NOT NULL,
    island_slug text NOT NULL,
    genre text NOT NULL,
    mark text NOT NULL,
    name text NOT NULL,
    venue text NOT NULL,
    area text NOT NULL,
    on_date date NOT NULL,
    time_mins integer NOT NULL,
    entry_paise integer NOT NULL,
    capacity integer NOT NULL,
    rating numeric(2,1) NOT NULL,
    reviews integer DEFAULT 0 NOT NULL,
    about text NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    photo_path text,
    rejection_reason text,
    seed_rating numeric(2,1),
    seed_reviews integer DEFAULT 0 NOT NULL,
    age_restriction text DEFAULT 'all-ages'::text NOT NULL,
    performer text,
    CONSTRAINT events_age_restriction_check CHECK ((age_restriction = ANY (ARRAY['all-ages'::text, '18+'::text, '21+'::text]))),
    CONSTRAINT events_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT events_entry_paise_check CHECK ((entry_paise >= 0)),
    CONSTRAINT events_genre_check CHECK ((genre = ANY (ARRAY['dj'::text, 'live'::text, 'bonfire'::text, 'karaoke'::text]))),
    CONSTRAINT events_time_mins_check CHECK (((time_mins >= 0) AND (time_mins <= 1439)))
);


--
-- Name: ferry_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ferry_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_item_id uuid NOT NULL,
    full_name text NOT NULL,
    age integer NOT NULL,
    gender text NOT NULL,
    nationality text DEFAULT 'Indian'::text NOT NULL,
    id_type text NOT NULL,
    id_number text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ferry_passengers_age_check CHECK (((age >= 0) AND (age <= 120))),
    CONSTRAINT ferry_passengers_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text]))),
    CONSTRAINT ferry_passengers_id_type_check CHECK ((id_type = ANY (ARRAY['aadhaar'::text, 'passport'::text, 'driving-licence'::text])))
);


--
-- Name: islands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.islands (
    slug text NOT NULL,
    name text NOT NULL,
    official_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: listing_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_closures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    on_date date NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_closures_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'trip'::text, 'rental'::text])))
);


--
-- Name: listing_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_kind text NOT NULL,
    listing_id uuid NOT NULL,
    storage_path text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_photos_listing_kind_check CHECK ((listing_kind = ANY (ARRAY['activity'::text, 'rental'::text, 'table'::text, 'event'::text, 'trip'::text, 'ferry'::text, 'cab'::text])))
);


--
-- Name: listing_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_views (
    id bigint NOT NULL,
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_views_kind_check CHECK ((kind = ANY (ARRAY['activity'::text, 'table'::text, 'event'::text, 'trip'::text, 'rental'::text, 'cab'::text])))
);


--
-- Name: listing_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.listing_views ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.listing_views_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: my_bookings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.my_bookings WITH (security_invoker='on') AS
 SELECT i.id AS item_id,
    b.id AS booking_id,
    b.ref_code,
    b.on_date,
    b.island_slug,
    isl.name AS island_name,
    i.kind,
    i.subject_id,
    public.subject_title(i.kind, i.subject_id) AS title,
    public.partner_name(i.partner_id) AS operator,
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
    public.partner_maps_url(i.partner_id) AS maps_url,
    public.partner_address(i.partner_id) AS address,
    public.partner_photo_path(i.partner_id) AS photo_path,
    i.confirmed_at,
    b.created_at AS booked_at,
    ( SELECT count(*) AS count
           FROM public.booking_messages m
          WHERE ((m.item_id = i.id) AND (m.sender = 'partner'::text) AND (m.read_at IS NULL))) AS unread_from_partner,
    ( SELECT rv.rating
           FROM public.reviews rv
          WHERE (rv.item_id = i.id)) AS my_rating,
    public.partner_phone(i.partner_id) AS operator_phone
   FROM ((public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
     JOIN public.islands isl ON ((isl.slug = b.island_slug)));


--
-- Name: partner_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_users (
    user_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'staff'::text])))
);


--
-- Name: partner_bookings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.partner_bookings WITH (security_invoker='on') AS
 SELECT i.id AS item_id,
    i.partner_id,
    b.ref_code,
    i.kind,
    public.subject_title(i.kind, i.subject_id) AS title,
    i.starts_at,
    i.party,
    i.price_paise,
    i.state,
    i.ticket_code,
    i.redeemed_at,
    b.contact_phone,
    b.contact_email,
    i.cancelled_note,
    i.confirmed_at,
    b.created_at AS booked_at,
    ( SELECT count(*) AS count
           FROM public.booking_messages m
          WHERE ((m.item_id = i.id) AND (m.sender = 'traveller'::text) AND (m.read_at IS NULL))) AS unread_from_traveller,
    i.subject_id,
    i.pay_mode,
    i.paid_online_paise,
    i.balance_paise,
    i.refunded_paise
   FROM (public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
  WHERE (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = i.partner_id) AND (pu.user_id = auth.uid()))));


--
-- Name: partner_cancellations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.partner_cancellations WITH (security_invoker='on') AS
 SELECT i.partner_id,
    b.ref_code,
    i.kind,
    public.subject_title(i.kind, i.subject_id) AS title,
    i.party,
    i.price_paise,
    i.starts_at,
    i.cancelled_at,
    cr.bps AS commission_bps,
    i.pay_mode,
    i.paid_online_paise,
    i.refunded_paise
   FROM ((public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
     LEFT JOIN public.commission_rates cr ON ((cr.kind = i.kind)))
  WHERE ((i.state = 'refunded'::text) AND (i.cancelled_at IS NOT NULL) AND ((i.paid_online_paise - i.refunded_paise) > 0) AND (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = i.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: partner_delivered; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.partner_delivered WITH (security_invoker='on') AS
 SELECT i.partner_id,
    b.ref_code,
    i.kind,
    public.subject_title(i.kind, i.subject_id) AS title,
    i.party,
    i.price_paise,
    i.starts_at,
    i.redeemed_at,
    cr.bps AS commission_bps,
    i.pay_mode,
    i.paid_online_paise,
    i.balance_paise,
    i.refunded_paise
   FROM ((public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
     LEFT JOIN public.commission_rates cr ON ((cr.kind = i.kind)))
  WHERE ((i.redeemed_at IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = i.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: partner_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    CONSTRAINT partner_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'staff'::text])))
);


--
-- Name: partner_notification_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_notification_prefs (
    partner_id uuid NOT NULL,
    notify_new_booking boolean DEFAULT true NOT NULL,
    notify_cancellation boolean DEFAULT true NOT NULL,
    notify_message boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: partner_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    item_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_notifications_kind_check CHECK ((kind = ANY (ARRAY['booking_new'::text, 'booking_cancelled'::text, 'booking_disrupted'::text, 'booking_message'::text, 'review'::text, 'support'::text])))
);


--
-- Name: partner_reviews; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.partner_reviews WITH (security_invoker='on') AS
 SELECT id,
    partner_id,
    kind,
    subject_id,
    public.subject_title(kind, subject_id) AS listing_title,
    rating,
    body,
    reply,
    replied_at,
    created_at
   FROM public.reviews r
  WHERE (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = r.partner_id) AND (pu.user_id = auth.uid()))));


--
-- Name: partner_view_counts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.partner_view_counts WITH (security_invoker='on') AS
 SELECT partner_id,
    kind,
    subject_id,
    public.subject_title(kind, subject_id) AS listing_title,
    count(*) AS views_all,
    count(*) FILTER (WHERE (viewed_at > (now() - '30 days'::interval))) AS views_30d
   FROM public.listing_views lv
  WHERE (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = lv.partner_id) AND (pu.user_id = auth.uid()))))
  GROUP BY partner_id, kind, subject_id, (public.subject_title(kind, subject_id));


--
-- Name: payout_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_accounts (
    partner_id uuid NOT NULL,
    account_name text,
    account_number text,
    ifsc text,
    upi_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rental_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_hours (
    partner_id uuid NOT NULL,
    dow integer NOT NULL,
    open_mins integer NOT NULL,
    close_mins integer NOT NULL,
    CONSTRAINT rental_hours_check CHECK ((open_mins < close_mins)),
    CONSTRAINT rental_hours_close_mins_check CHECK (((close_mins >= 0) AND (close_mins <= 1439))),
    CONSTRAINT rental_hours_dow_check CHECK (((dow >= 0) AND (dow <= 6))),
    CONSTRAINT rental_hours_open_mins_check CHECK (((open_mins >= 0) AND (open_mins <= 1439)))
);


--
-- Name: restaurant_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    time_mins integer NOT NULL,
    table_count integer NOT NULL,
    seats_per_table integer DEFAULT 4 NOT NULL,
    days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    CONSTRAINT restaurant_tables_seats_per_table_check CHECK ((seats_per_table > 0)),
    CONSTRAINT restaurant_tables_table_count_check CHECK ((table_count > 0)),
    CONSTRAINT restaurant_tables_time_mins_check CHECK (((time_mins >= 0) AND (time_mins <= 1439)))
);


--
-- Name: restaurants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    partner_id uuid NOT NULL,
    island_slug text NOT NULL,
    category text NOT NULL,
    mark text NOT NULL,
    name text NOT NULL,
    area text NOT NULL,
    distance_label text NOT NULL,
    price_tier integer NOT NULL,
    rating numeric(2,1) NOT NULL,
    reviews integer DEFAULT 0 NOT NULL,
    blurb text NOT NULL,
    about text NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    photo_path text,
    rejection_reason text,
    seed_rating numeric(2,1),
    seed_reviews integer DEFAULT 0 NOT NULL,
    CONSTRAINT restaurants_category_check CHECK ((category = ANY (ARRAY['seafood'::text, 'indian'::text, 'continental'::text, 'cafe'::text]))),
    CONSTRAINT restaurants_price_tier_check CHECK (((price_tier >= 1) AND (price_tier <= 3)))
);


--
-- Name: sailings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sailings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    partner_id uuid NOT NULL,
    from_island text NOT NULL,
    to_island text NOT NULL,
    style_label text NOT NULL,
    dep_mins integer NOT NULL,
    duration_mins integer NOT NULL,
    fare_paise integer NOT NULL,
    capacity integer NOT NULL,
    days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    style_tone text DEFAULT 'plain'::text NOT NULL,
    info text DEFAULT ''::text NOT NULL,
    info_warn boolean DEFAULT false NOT NULL,
    photo_path text,
    rejection_reason text,
    CONSTRAINT sailings_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT sailings_dep_mins_check CHECK (((dep_mins >= 0) AND (dep_mins <= 1439))),
    CONSTRAINT sailings_duration_mins_check CHECK ((duration_mins > 0)),
    CONSTRAINT sailings_fare_paise_check CHECK ((fare_paise >= 0)),
    CONSTRAINT sailings_style_tone_check CHECK ((style_tone = ANY (ARRAY['good'::text, 'warm'::text, 'plain'::text])))
);


--
-- Name: traveller_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traveller_profiles (
    user_id uuid NOT NULL,
    phone text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text
);


--
-- Name: trip_travellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_travellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_item_id uuid NOT NULL,
    full_name text NOT NULL,
    age integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trip_travellers_age_check CHECK (((age >= 0) AND (age <= 120)))
);


--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    partner_id uuid NOT NULL,
    island_slug text NOT NULL,
    title text NOT NULL,
    host_name text NOT NULL,
    host_since text NOT NULL,
    duration_label text NOT NULL,
    runs_on_days integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    price_paise integer NOT NULL,
    min_seats integer NOT NULL,
    seats_total integer NOT NULL,
    rating numeric(2,1) NOT NULL,
    reviews integer DEFAULT 0 NOT NULL,
    summary text NOT NULL,
    includes text[] DEFAULT '{}'::text[] NOT NULL,
    meet_point text NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    photo_path text,
    rejection_reason text,
    seed_rating numeric(2,1),
    seed_reviews integer DEFAULT 0 NOT NULL,
    difficulty text DEFAULT 'moderate'::text NOT NULL,
    bring_list text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT trips_check1 CHECK ((min_seats <= seats_total)),
    CONSTRAINT trips_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'moderate'::text, 'challenging'::text]))),
    CONSTRAINT trips_min_seats_check CHECK ((min_seats > 0)),
    CONSTRAINT trips_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT trips_seats_total_check CHECK ((seats_total > 0))
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    partner_id uuid NOT NULL,
    type text NOT NULL,
    model text NOT NULL,
    rate_paise integer NOT NULL,
    seats integer DEFAULT 2 NOT NULL,
    meta text NOT NULL,
    units integer DEFAULT 1 NOT NULL,
    is_listed boolean DEFAULT true NOT NULL,
    photo_path text,
    rejection_reason text,
    security_deposit_paise integer DEFAULT 0 NOT NULL,
    CONSTRAINT vehicles_rate_paise_check CHECK ((rate_paise >= 0)),
    CONSTRAINT vehicles_seats_check CHECK ((seats > 0)),
    CONSTRAINT vehicles_security_deposit_paise_check CHECK ((security_deposit_paise >= 0)),
    CONSTRAINT vehicles_type_check CHECK ((type = ANY (ARRAY['scooter'::text, 'bike'::text, 'bicycle'::text]))),
    CONSTRAINT vehicles_units_check CHECK ((units > 0))
);


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activities activities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_slug_key UNIQUE (slug);


--
-- Name: activity_schedule activity_schedule_activity_id_time_mins_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_schedule
    ADD CONSTRAINT activity_schedule_activity_id_time_mins_key UNIQUE (activity_id, time_mins);


--
-- Name: activity_schedule activity_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_schedule
    ADD CONSTRAINT activity_schedule_pkey PRIMARY KEY (id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);


--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (kind, subject_id, starts_at);


--
-- Name: booking_items booking_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_pkey PRIMARY KEY (id);


--
-- Name: booking_messages booking_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_ref_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_ref_code_key UNIQUE (ref_code);


--
-- Name: cab_places cab_places_island_slug_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_places
    ADD CONSTRAINT cab_places_island_slug_label_key UNIQUE (island_slug, label);


--
-- Name: cab_places cab_places_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_places
    ADD CONSTRAINT cab_places_pkey PRIMARY KEY (id);


--
-- Name: cab_routes cab_routes_cab_id_from_place_id_to_place_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_routes
    ADD CONSTRAINT cab_routes_cab_id_from_place_id_to_place_id_key UNIQUE (cab_id, from_place_id, to_place_id);


--
-- Name: cab_routes cab_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_routes
    ADD CONSTRAINT cab_routes_pkey PRIMARY KEY (id);


--
-- Name: cab_trip_details cab_trip_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_trip_details
    ADD CONSTRAINT cab_trip_details_pkey PRIMARY KEY (item_id);


--
-- Name: cabs cabs_partner_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabs
    ADD CONSTRAINT cabs_partner_id_code_key UNIQUE (partner_id, code);


--
-- Name: cabs cabs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabs
    ADD CONSTRAINT cabs_pkey PRIMARY KEY (id);


--
-- Name: category_payment category_payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_payment
    ADD CONSTRAINT category_payment_pkey PRIMARY KEY (kind);


--
-- Name: commission_rates commission_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rates
    ADD CONSTRAINT commission_rates_pkey PRIMARY KEY (kind);


--
-- Name: event_guests event_guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: events events_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_slug_key UNIQUE (slug);


--
-- Name: ferry_passengers ferry_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ferry_passengers
    ADD CONSTRAINT ferry_passengers_pkey PRIMARY KEY (id);


--
-- Name: islands islands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.islands
    ADD CONSTRAINT islands_pkey PRIMARY KEY (slug);


--
-- Name: listing_closures listing_closures_kind_subject_id_on_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_closures
    ADD CONSTRAINT listing_closures_kind_subject_id_on_date_key UNIQUE (kind, subject_id, on_date);


--
-- Name: listing_closures listing_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_closures
    ADD CONSTRAINT listing_closures_pkey PRIMARY KEY (id);


--
-- Name: listing_photos listing_photos_listing_kind_listing_id_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_photos
    ADD CONSTRAINT listing_photos_listing_kind_listing_id_storage_path_key UNIQUE (listing_kind, listing_id, storage_path);


--
-- Name: listing_photos listing_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_photos
    ADD CONSTRAINT listing_photos_pkey PRIMARY KEY (id);


--
-- Name: listing_views listing_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_views
    ADD CONSTRAINT listing_views_pkey PRIMARY KEY (id);


--
-- Name: partner_invites partner_invites_partner_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_invites
    ADD CONSTRAINT partner_invites_partner_id_email_key UNIQUE (partner_id, email);


--
-- Name: partner_invites partner_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_invites
    ADD CONSTRAINT partner_invites_pkey PRIMARY KEY (id);


--
-- Name: partner_notification_prefs partner_notification_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_notification_prefs
    ADD CONSTRAINT partner_notification_prefs_pkey PRIMARY KEY (partner_id);


--
-- Name: partner_notifications partner_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_notifications
    ADD CONSTRAINT partner_notifications_pkey PRIMARY KEY (id);


--
-- Name: partner_users partner_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_users
    ADD CONSTRAINT partner_users_pkey PRIMARY KEY (user_id);


--
-- Name: partners partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);


--
-- Name: partners partners_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_slug_key UNIQUE (slug);


--
-- Name: payout_accounts payout_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_pkey PRIMARY KEY (partner_id);


--
-- Name: rental_hours rental_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_hours
    ADD CONSTRAINT rental_hours_pkey PRIMARY KEY (partner_id, dow);


--
-- Name: restaurant_tables restaurant_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_tables
    ADD CONSTRAINT restaurant_tables_pkey PRIMARY KEY (id);


--
-- Name: restaurant_tables restaurant_tables_restaurant_id_time_mins_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_tables
    ADD CONSTRAINT restaurant_tables_restaurant_id_time_mins_key UNIQUE (restaurant_id, time_mins);


--
-- Name: restaurants restaurants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_slug_key UNIQUE (slug);


--
-- Name: reviews reviews_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_item_id_key UNIQUE (item_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: sailings sailings_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sailings
    ADD CONSTRAINT sailings_code_key UNIQUE (code);


--
-- Name: sailings sailings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sailings
    ADD CONSTRAINT sailings_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_threads support_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads
    ADD CONSTRAINT support_threads_pkey PRIMARY KEY (partner_id);


--
-- Name: traveller_profiles traveller_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveller_profiles
    ADD CONSTRAINT traveller_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: trip_travellers trip_travellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_travellers
    ADD CONSTRAINT trip_travellers_pkey PRIMARY KEY (id);


--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);


--
-- Name: trips trips_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_slug_key UNIQUE (slug);


--
-- Name: vehicles vehicles_partner_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_partner_id_code_key UNIQUE (partner_id, code);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: activities_island_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_island_idx ON public.activities USING btree (island_slug, is_listed);


--
-- Name: booking_items_starts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_items_starts_idx ON public.booking_items USING btree (starts_at DESC);


--
-- Name: booking_items_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_items_subject_idx ON public.booking_items USING btree (kind, subject_id, starts_at);


--
-- Name: booking_items_ticket_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_items_ticket_code_key ON public.booking_items USING btree (ticket_code) WHERE (ticket_code IS NOT NULL);


--
-- Name: booking_items_ticket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_items_ticket_idx ON public.booking_items USING btree (ticket_code);


--
-- Name: booking_messages_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_messages_booking_idx ON public.booking_messages USING btree (booking_id);


--
-- Name: booking_messages_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_messages_partner_idx ON public.booking_messages USING btree (partner_id);


--
-- Name: booking_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_messages_thread_idx ON public.booking_messages USING btree (item_id, created_at);


--
-- Name: bookings_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_user_idx ON public.bookings USING btree (user_id, on_date DESC);


--
-- Name: cabs_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabs_partner_idx ON public.cabs USING btree (partner_id, is_listed);


--
-- Name: event_guests_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_guests_item_idx ON public.event_guests USING btree (booking_item_id);


--
-- Name: events_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_date_idx ON public.events USING btree (island_slug, on_date, is_listed);


--
-- Name: ferry_passengers_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ferry_passengers_item_idx ON public.ferry_passengers USING btree (booking_item_id);


--
-- Name: listing_closures_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_closures_partner_idx ON public.listing_closures USING btree (partner_id);


--
-- Name: listing_photos_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_photos_lookup ON public.listing_photos USING btree (listing_kind, listing_id, sort_order);


--
-- Name: listing_views_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_views_partner_idx ON public.listing_views USING btree (partner_id, subject_id, viewed_at);


--
-- Name: partner_invites_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_invites_email_idx ON public.partner_invites USING btree (email) WHERE (accepted_at IS NULL);


--
-- Name: partner_notifications_feed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_notifications_feed_idx ON public.partner_notifications USING btree (partner_id, created_at DESC);


--
-- Name: partner_users_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_users_partner_idx ON public.partner_users USING btree (partner_id);


--
-- Name: partners_island_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partners_island_idx ON public.partners USING btree (island_slug, status);


--
-- Name: restaurants_island_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX restaurants_island_idx ON public.restaurants USING btree (island_slug, is_listed);


--
-- Name: reviews_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_partner_idx ON public.reviews USING btree (partner_id);


--
-- Name: reviews_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_subject_idx ON public.reviews USING btree (kind, subject_id);


--
-- Name: sailings_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sailings_route_idx ON public.sailings USING btree (from_island, to_island, is_listed);


--
-- Name: support_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_thread_idx ON public.support_messages USING btree (partner_id, created_at);


--
-- Name: trip_travellers_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trip_travellers_item_idx ON public.trip_travellers USING btree (booking_item_id);


--
-- Name: waitlist_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waitlist_email_key ON public.waitlist USING btree (lower(email));


--
-- Name: booking_items booking_items_notify_partner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_items_notify_partner AFTER INSERT OR UPDATE ON public.booking_items FOR EACH ROW EXECUTE FUNCTION public.notify_partner_of_booking();


--
-- Name: booking_items booking_items_sync_availability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_items_sync_availability AFTER INSERT OR DELETE OR UPDATE ON public.booking_items FOR EACH ROW EXECUTE FUNCTION public.sync_availability();


--
-- Name: booking_messages booking_messages_notify_partner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_messages_notify_partner AFTER INSERT ON public.booking_messages FOR EACH ROW EXECUTE FUNCTION public.notify_partner_of_message();


--
-- Name: reviews reviews_notify_partner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reviews_notify_partner AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_partner_of_review();


--
-- Name: reviews reviews_recompute_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reviews_recompute_rating AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.recompute_listing_rating();


--
-- Name: support_messages support_messages_notify_partner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER support_messages_notify_partner AFTER INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.notify_partner_of_support();


--
-- Name: activities activities_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: activities activities_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: activity_schedule activity_schedule_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_schedule
    ADD CONSTRAINT activity_schedule_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: booking_items booking_items_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_items booking_items_cab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_cab_id_fkey FOREIGN KEY (cab_id) REFERENCES public.cabs(id);


--
-- Name: booking_items booking_items_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id);


--
-- Name: booking_items booking_items_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES public.partners(id);


--
-- Name: booking_items booking_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.vehicles(id);


--
-- Name: booking_messages booking_messages_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_messages booking_messages_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: booking_messages booking_messages_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: cab_places cab_places_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_places
    ADD CONSTRAINT cab_places_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: cab_routes cab_routes_cab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_routes
    ADD CONSTRAINT cab_routes_cab_id_fkey FOREIGN KEY (cab_id) REFERENCES public.cabs(id) ON DELETE CASCADE;


--
-- Name: cab_routes cab_routes_from_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_routes
    ADD CONSTRAINT cab_routes_from_place_id_fkey FOREIGN KEY (from_place_id) REFERENCES public.cab_places(id);


--
-- Name: cab_routes cab_routes_to_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_routes
    ADD CONSTRAINT cab_routes_to_place_id_fkey FOREIGN KEY (to_place_id) REFERENCES public.cab_places(id);


--
-- Name: cab_trip_details cab_trip_details_from_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_trip_details
    ADD CONSTRAINT cab_trip_details_from_place_id_fkey FOREIGN KEY (from_place_id) REFERENCES public.cab_places(id);


--
-- Name: cab_trip_details cab_trip_details_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_trip_details
    ADD CONSTRAINT cab_trip_details_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: cab_trip_details cab_trip_details_to_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cab_trip_details
    ADD CONSTRAINT cab_trip_details_to_place_id_fkey FOREIGN KEY (to_place_id) REFERENCES public.cab_places(id);


--
-- Name: cabs cabs_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabs
    ADD CONSTRAINT cabs_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: event_guests event_guests_booking_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_guests
    ADD CONSTRAINT event_guests_booking_item_id_fkey FOREIGN KEY (booking_item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: events events_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: events events_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: ferry_passengers ferry_passengers_booking_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ferry_passengers
    ADD CONSTRAINT ferry_passengers_booking_item_id_fkey FOREIGN KEY (booking_item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: listing_closures listing_closures_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_closures
    ADD CONSTRAINT listing_closures_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: listing_views listing_views_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_views
    ADD CONSTRAINT listing_views_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_invites partner_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_invites
    ADD CONSTRAINT partner_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: partner_invites partner_invites_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_invites
    ADD CONSTRAINT partner_invites_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_notification_prefs partner_notification_prefs_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_notification_prefs
    ADD CONSTRAINT partner_notification_prefs_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_notifications partner_notifications_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_notifications
    ADD CONSTRAINT partner_notifications_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_users partner_users_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_users
    ADD CONSTRAINT partner_users_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_users partner_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_users
    ADD CONSTRAINT partner_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: partners partners_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: payout_accounts payout_accounts_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: rental_hours rental_hours_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_hours
    ADD CONSTRAINT rental_hours_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: restaurant_tables restaurant_tables_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_tables
    ADD CONSTRAINT restaurant_tables_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurants restaurants_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: restaurants restaurants_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sailings sailings_from_island_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sailings
    ADD CONSTRAINT sailings_from_island_fkey FOREIGN KEY (from_island) REFERENCES public.islands(slug);


--
-- Name: sailings sailings_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sailings
    ADD CONSTRAINT sailings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: sailings sailings_to_island_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sailings
    ADD CONSTRAINT sailings_to_island_fkey FOREIGN KEY (to_island) REFERENCES public.islands(slug);


--
-- Name: support_messages support_messages_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: support_threads support_threads_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_threads
    ADD CONSTRAINT support_threads_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: traveller_profiles traveller_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveller_profiles
    ADD CONSTRAINT traveller_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trip_travellers trip_travellers_booking_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_travellers
    ADD CONSTRAINT trip_travellers_booking_item_id_fkey FOREIGN KEY (booking_item_id) REFERENCES public.booking_items(id) ON DELETE CASCADE;


--
-- Name: trips trips_island_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_island_slug_fkey FOREIGN KEY (island_slug) REFERENCES public.islands(slug);


--
-- Name: trips trips_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: vehicles vehicles_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: activities admins see all activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all activities" ON public.activities FOR SELECT USING (public.is_admin());


--
-- Name: booking_items admins see all booking items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all booking items" ON public.booking_items FOR SELECT USING (public.is_admin());


--
-- Name: bookings admins see all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all bookings" ON public.bookings FOR SELECT USING (public.is_admin());


--
-- Name: cab_places admins see all cab places; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all cab places" ON public.cab_places FOR SELECT USING (public.is_admin());


--
-- Name: cab_routes admins see all cab routes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all cab routes" ON public.cab_routes FOR SELECT USING (public.is_admin());


--
-- Name: cabs admins see all cabs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all cabs" ON public.cabs FOR SELECT USING (public.is_admin());


--
-- Name: event_guests admins see all event guests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all event guests" ON public.event_guests FOR SELECT USING (public.is_admin());


--
-- Name: events admins see all events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all events" ON public.events FOR SELECT USING (public.is_admin());


--
-- Name: ferry_passengers admins see all ferry passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all ferry passengers" ON public.ferry_passengers FOR SELECT USING (public.is_admin());


--
-- Name: listing_photos admins see all listing photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all listing photos" ON public.listing_photos FOR SELECT USING (public.is_admin());


--
-- Name: partners admins see all partners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all partners" ON public.partners FOR SELECT USING (public.is_admin());


--
-- Name: restaurants admins see all restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all restaurants" ON public.restaurants FOR SELECT USING (public.is_admin());


--
-- Name: reviews admins see all reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all reviews" ON public.reviews FOR SELECT USING (public.is_admin());


--
-- Name: sailings admins see all sailings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all sailings" ON public.sailings FOR SELECT USING (public.is_admin());


--
-- Name: trip_travellers admins see all trip travellers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all trip travellers" ON public.trip_travellers FOR SELECT USING (public.is_admin());


--
-- Name: trips admins see all trips; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all trips" ON public.trips FOR SELECT USING (public.is_admin());


--
-- Name: vehicles admins see all vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see all vehicles" ON public.vehicles FOR SELECT USING (public.is_admin());


--
-- Name: admins admins see own row; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins see own row" ON public.admins FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: partners approved partners are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approved partners are public" ON public.partners FOR SELECT USING ((status = 'approved'::text));


--
-- Name: availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_items ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: cab_places cab places are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cab places are public" ON public.cab_places FOR SELECT USING (is_active);


--
-- Name: cab_trip_details cab trip details follow the booking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cab trip details follow the booking" ON public.cab_trip_details FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
  WHERE ((i.id = cab_trip_details.item_id) AND ((b.user_id = auth.uid()) OR public.is_admin() OR (EXISTS ( SELECT 1
           FROM public.partner_users pu
          WHERE ((pu.partner_id = i.partner_id) AND (pu.user_id = auth.uid())))))))));


--
-- Name: cab_places; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cab_places ENABLE ROW LEVEL SECURITY;

--
-- Name: cab_routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cab_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: cab_trip_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cab_trip_details ENABLE ROW LEVEL SECURITY;

--
-- Name: cabs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabs ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_schedule catalogue is public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "catalogue is public" ON public.activity_schedule FOR SELECT USING (true);


--
-- Name: islands catalogue is public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "catalogue is public" ON public.islands FOR SELECT USING (true);


--
-- Name: restaurant_tables catalogue is public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "catalogue is public" ON public.restaurant_tables FOR SELECT USING (true);


--
-- Name: category_payment category payment is readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "category payment is readable" ON public.category_payment FOR SELECT USING (true);


--
-- Name: category_payment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.category_payment ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_closures closures are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "closures are public" ON public.listing_closures FOR SELECT USING (true);


--
-- Name: commission_rates commission rates are readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "commission rates are readable" ON public.commission_rates FOR SELECT USING (true);


--
-- Name: commission_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: availability counts are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "counts are public" ON public.availability FOR SELECT USING (true);


--
-- Name: event_guests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: ferry_passengers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ferry_passengers ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_invites invited user reads own invite; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invited user reads own invite" ON public.partner_invites FOR SELECT USING (((accepted_at IS NULL) AND (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));


--
-- Name: islands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.islands ENABLE ROW LEVEL SECURITY;

--
-- Name: activities listed activities are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed activities are public" ON public.activities FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = activities.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: cabs listed cabs are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed cabs are public" ON public.cabs FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = cabs.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: events listed events are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed events are public" ON public.events FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = events.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: restaurants listed restaurants are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed restaurants are public" ON public.restaurants FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = restaurants.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: sailings listed sailings are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed sailings are public" ON public.sailings FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = sailings.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: trips listed trips are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed trips are public" ON public.trips FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = trips.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: vehicles listed vehicles are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listed vehicles are public" ON public.vehicles FOR SELECT USING ((is_listed AND (EXISTS ( SELECT 1
   FROM public.partners p
  WHERE ((p.id = vehicles.partner_id) AND (p.status = 'approved'::text))))));


--
-- Name: listing_photos listing photos are as public as their listing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "listing photos are as public as their listing" ON public.listing_photos FOR SELECT USING (public.listing_is_public(listing_kind, listing_id));


--
-- Name: listing_closures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_views ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_items own booking items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own booking items" ON public.booking_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_items.booking_id) AND (b.user_id = auth.uid())))));


--
-- Name: bookings own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own bookings" ON public.bookings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: event_guests own event guests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own event guests" ON public.event_guests FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
  WHERE ((i.id = event_guests.booking_item_id) AND (b.user_id = auth.uid())))));


--
-- Name: ferry_passengers own ferry passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ferry passengers" ON public.ferry_passengers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
  WHERE ((i.id = ferry_passengers.booking_item_id) AND (b.user_id = auth.uid())))));


--
-- Name: payout_accounts own or admin payout account; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own or admin payout account" ON public.payout_accounts FOR SELECT USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = payout_accounts.partner_id) AND (pu.user_id = auth.uid()))))));


--
-- Name: partner_users own partner link; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own partner link" ON public.partner_users FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: traveller_profiles own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own profile" ON public.traveller_profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trip_travellers own trip travellers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own trip travellers" ON public.trip_travellers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.bookings b ON ((b.id = i.booking_id)))
  WHERE ((i.id = trip_travellers.booking_item_id) AND (b.user_id = auth.uid())))));


--
-- Name: partner_invites owner reads team invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner reads team invites" ON public.partner_invites FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = partner_invites.partner_id) AND (pu.user_id = auth.uid()) AND (pu.role = 'owner'::text)))));


--
-- Name: booking_messages partner reads its thread; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner reads its thread" ON public.booking_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = booking_messages.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: listing_views partner reads own listing views; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner reads own listing views" ON public.listing_views FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = listing_views.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: support_messages partner reads own support messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner reads own support messages" ON public.support_messages FOR SELECT USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = support_messages.partner_id) AND (pu.user_id = auth.uid()))))));


--
-- Name: support_threads partner reads own support thread; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner reads own support thread" ON public.support_threads FOR SELECT USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = support_threads.partner_id) AND (pu.user_id = auth.uid()))))));


--
-- Name: activities partner sees own activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own activities" ON public.activities FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = activities.partner_id)))));


--
-- Name: partners partner sees own business; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own business" ON public.partners FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = partners.id)))));


--
-- Name: cab_routes partner sees own cab routes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own cab routes" ON public.cab_routes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.cabs c
     JOIN public.partner_users pu ON ((pu.partner_id = c.partner_id)))
  WHERE ((c.id = cab_routes.cab_id) AND (pu.user_id = auth.uid())))));


--
-- Name: cabs partner sees own cabs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own cabs" ON public.cabs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = cabs.partner_id)))));


--
-- Name: event_guests partner sees own event guests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own event guests" ON public.event_guests FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.partner_users pu ON ((pu.partner_id = i.partner_id)))
  WHERE ((i.id = event_guests.booking_item_id) AND (pu.user_id = auth.uid())))));


--
-- Name: events partner sees own events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own events" ON public.events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = events.partner_id)))));


--
-- Name: booking_items partner sees own items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own items" ON public.booking_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = booking_items.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: listing_photos partner sees own listing photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own listing photos" ON public.listing_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = public.listing_partner_id(listing_photos.listing_kind, listing_photos.listing_id))))));


--
-- Name: partner_notifications partner sees own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own notifications" ON public.partner_notifications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = partner_notifications.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: partner_notification_prefs partner sees own prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own prefs" ON public.partner_notification_prefs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = partner_notification_prefs.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: restaurants partner sees own restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own restaurants" ON public.restaurants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = restaurants.partner_id)))));


--
-- Name: sailings partner sees own sailings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own sailings" ON public.sailings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = sailings.partner_id)))));


--
-- Name: trip_travellers partner sees own trip travellers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own trip travellers" ON public.trip_travellers FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.booking_items i
     JOIN public.partner_users pu ON ((pu.partner_id = i.partner_id)))
  WHERE ((i.id = trip_travellers.booking_item_id) AND (pu.user_id = auth.uid())))));


--
-- Name: trips partner sees own trips; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own trips" ON public.trips FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = trips.partner_id)))));


--
-- Name: vehicles partner sees own vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees own vehicles" ON public.vehicles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.user_id = auth.uid()) AND (pu.partner_id = vehicles.partner_id)))));


--
-- Name: bookings partner sees related bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees related bookings" ON public.bookings FOR SELECT USING (public.is_partner_for_booking(id));


--
-- Name: reviews partner sees reviews of its listings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "partner sees reviews of its listings" ON public.reviews FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.partner_users pu
  WHERE ((pu.partner_id = reviews.partner_id) AND (pu.user_id = auth.uid())))));


--
-- Name: partner_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_notification_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_notification_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;

--
-- Name: partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: rental_hours rental hours are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rental hours are public" ON public.rental_hours FOR SELECT USING (true);


--
-- Name: rental_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: cab_routes routes of a listed cab are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "routes of a listed cab are public" ON public.cab_routes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.cabs c
     JOIN public.partners p ON ((p.id = c.partner_id)))
  WHERE ((c.id = cab_routes.cab_id) AND c.is_listed AND (p.status = 'approved'::text)))));


--
-- Name: sailings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sailings ENABLE ROW LEVEL SECURITY;

--
-- Name: support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_messages traveller reads its booking thread; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "traveller reads its booking thread" ON public.booking_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = booking_messages.booking_id) AND (b.user_id = auth.uid())))));


--
-- Name: reviews traveller sees own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "traveller sees own reviews" ON public.reviews FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: traveller_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.traveller_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_travellers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trip_travellers ENABLE ROW LEVEL SECURITY;

--
-- Name: trips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist waitlist_insert_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_insert_public ON public.waitlist FOR INSERT TO authenticated, anon WITH CHECK (((email IS NOT NULL) AND ((length(email) >= 3) AND (length(email) <= 254)) AND (email ~~ '%@%'::text)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION accept_partner_invite(p_invite_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_partner_invite(p_invite_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_partner_invite(p_invite_id uuid) TO anon;
GRANT ALL ON FUNCTION public.accept_partner_invite(p_invite_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.accept_partner_invite(p_invite_id uuid) TO service_role;


--
-- Name: FUNCTION add_partner_activity(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_partner_activity(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_activity(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_activity(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_activity_impl(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_activity_impl(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_activity_impl(p_category text, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_car(p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_event(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_event_impl(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_event_impl(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_event_impl(p_genre text, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_restaurant(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_partner_restaurant(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_restaurant(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_restaurant(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_restaurant_impl(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_restaurant_impl(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_restaurant_impl(p_category text, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_sailing(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_partner_sailing(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_sailing(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_sailing(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_sailing_impl(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_sailing_impl(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_sailing_impl(p_from_island text, p_to_island text, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_trip(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_trip_impl(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_trip_impl(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_trip_impl(p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_vehicle(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_partner_vehicle(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.add_partner_vehicle(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.add_partner_vehicle(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION add_partner_vehicle_impl(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_partner_vehicle_impl(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_partner_vehicle_impl(p_type text, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION adjust_booking_party(p_item_id uuid, p_party integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.adjust_booking_party(p_item_id uuid, p_party integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adjust_booking_party(p_item_id uuid, p_party integer) TO anon;
GRANT ALL ON FUNCTION public.adjust_booking_party(p_item_id uuid, p_party integer) TO authenticated;
GRANT ALL ON FUNCTION public.adjust_booking_party(p_item_id uuid, p_party integer) TO service_role;


--
-- Name: FUNCTION admin_approve_listing(p_kind text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_approve_listing(p_kind text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_approve_listing(p_kind text, p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_approve_listing(p_kind text, p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_approve_listing(p_kind text, p_id uuid) TO service_role;


--
-- Name: FUNCTION admin_approve_partner(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_approve_partner(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_approve_partner(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_approve_partner(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_approve_partner(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_booking_thread(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_booking_thread(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_booking_thread(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_booking_thread(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_booking_thread(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION admin_cancel_booking(p_item_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_cancel_booking(p_item_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_cancel_booking(p_item_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_cancel_booking(p_item_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_cancel_booking(p_item_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_mark_support_read(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_mark_support_read(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_mark_support_read(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_mark_support_read(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_mark_support_read(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_partner_invites(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_partner_invites(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_partner_invites(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_partner_invites(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_partner_invites(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_partner_team(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_partner_team(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_partner_team(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_partner_team(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_partner_team(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_place_ferry_booking(p_item_id uuid, p_pnr text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_place_ferry_booking(p_item_id uuid, p_pnr text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_place_ferry_booking(p_item_id uuid, p_pnr text) TO anon;
GRANT ALL ON FUNCTION public.admin_place_ferry_booking(p_item_id uuid, p_pnr text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_place_ferry_booking(p_item_id uuid, p_pnr text) TO service_role;


--
-- Name: FUNCTION admin_reactivate_partner(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reactivate_partner(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reactivate_partner(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_reactivate_partner(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reactivate_partner(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_reject_listing(p_kind text, p_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reject_listing(p_kind text, p_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reject_listing(p_kind text, p_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_reject_listing(p_kind text, p_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reject_listing(p_kind text, p_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_reject_partner(p_partner_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reject_partner(p_partner_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reject_partner(p_partner_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_reject_partner(p_partner_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reject_partner(p_partner_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_remove_review(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_remove_review(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_remove_review(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_remove_review(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_remove_review(p_id uuid) TO service_role;


--
-- Name: FUNCTION admin_reply_support(p_partner_id uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reply_support(p_partner_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reply_support(p_partner_id uuid, p_body text) TO anon;
GRANT ALL ON FUNCTION public.admin_reply_support(p_partner_id uuid, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reply_support(p_partner_id uuid, p_body text) TO service_role;


--
-- Name: FUNCTION admin_set_support_status(p_partner_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_support_status(p_partner_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_support_status(p_partner_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.admin_set_support_status(p_partner_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_support_status(p_partner_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION admin_suspend_partner(p_partner_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_suspend_partner(p_partner_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_suspend_partner(p_partner_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_suspend_partner(p_partner_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_suspend_partner(p_partner_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_unlist_listing(p_kind text, p_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_unlist_listing(p_kind text, p_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_unlist_listing(p_kind text, p_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_unlist_listing(p_kind text, p_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_unlist_listing(p_kind text, p_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION assert_partner_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_partner_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_partner_owner() TO anon;
GRANT ALL ON FUNCTION public.assert_partner_owner() TO authenticated;
GRANT ALL ON FUNCTION public.assert_partner_owner() TO service_role;


--
-- Name: FUNCTION cab_load_on(p_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cab_load_on(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cab_load_on(p_date date) TO anon;
GRANT ALL ON FUNCTION public.cab_load_on(p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.cab_load_on(p_date date) TO service_role;


--
-- Name: FUNCTION cancel_my_booking_item(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_my_booking_item(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_my_booking_item(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cancel_my_booking_item(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_my_booking_item(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION clear_no_show(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_no_show(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_no_show(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.clear_no_show(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.clear_no_show(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.close_partner_date(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) TO service_role;


--
-- Name: FUNCTION close_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date, p_reason text) TO service_role;


--
-- Name: FUNCTION create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer, p_units integer, p_variant text, p_extras boolean, p_pay_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer, p_units integer, p_variant text, p_extras boolean, p_pay_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer, p_units integer, p_variant text, p_extras boolean, p_pay_mode text) TO anon;
GRANT ALL ON FUNCTION public.create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer, p_units integer, p_variant text, p_extras boolean, p_pay_mode text) TO authenticated;
GRANT ALL ON FUNCTION public.create_booking(p_kind text, p_subject text, p_starts_at timestamp with time zone, p_party integer, p_units integer, p_variant text, p_extras boolean, p_pay_mode text) TO service_role;


--
-- Name: FUNCTION create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date, p_days integer, p_pickup_note text, p_pay_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date, p_days integer, p_pickup_note text, p_pay_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date, p_days integer, p_pickup_note text, p_pay_mode text) TO anon;
GRANT ALL ON FUNCTION public.create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date, p_days integer, p_pickup_note text, p_pay_mode text) TO authenticated;
GRANT ALL ON FUNCTION public.create_cab_booking(p_operator text, p_cab text, p_trip_type text, p_from uuid, p_to uuid, p_starts_at timestamp with time zone, p_return_date date, p_days integer, p_pickup_note text, p_pay_mode text) TO service_role;


--
-- Name: FUNCTION invite_partner_staff(p_email text, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invite_partner_staff(p_email text, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_partner_staff(p_email text, p_role text) TO anon;
GRANT ALL ON FUNCTION public.invite_partner_staff(p_email text, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.invite_partner_staff(p_email text, p_role text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_partner_for_booking(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_partner_for_booking(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_partner_for_booking(p_booking_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_partner_for_booking(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_partner_for_booking(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION leave_review(p_item_id uuid, p_rating integer, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.leave_review(p_item_id uuid, p_rating integer, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_review(p_item_id uuid, p_rating integer, p_body text) TO anon;
GRANT ALL ON FUNCTION public.leave_review(p_item_id uuid, p_rating integer, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.leave_review(p_item_id uuid, p_rating integer, p_body text) TO service_role;


--
-- Name: FUNCTION listing_is_public(p_kind text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.listing_is_public(p_kind text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.listing_is_public(p_kind text, p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.listing_is_public(p_kind text, p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.listing_is_public(p_kind text, p_id uuid) TO service_role;


--
-- Name: FUNCTION listing_partner_id(p_kind text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.listing_partner_id(p_kind text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.listing_partner_id(p_kind text, p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.listing_partner_id(p_kind text, p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.listing_partner_id(p_kind text, p_id uuid) TO service_role;


--
-- Name: FUNCTION listing_reviews(p_kind text, p_subject text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.listing_reviews(p_kind text, p_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.listing_reviews(p_kind text, p_subject text) TO anon;
GRANT ALL ON FUNCTION public.listing_reviews(p_kind text, p_subject text) TO authenticated;
GRANT ALL ON FUNCTION public.listing_reviews(p_kind text, p_subject text) TO service_role;


--
-- Name: FUNCTION look_up_booking(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.look_up_booking(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.look_up_booking(p_code text) TO anon;
GRANT ALL ON FUNCTION public.look_up_booking(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.look_up_booking(p_code text) TO service_role;


--
-- Name: FUNCTION mark_booking_messages_read(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_booking_messages_read(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_booking_messages_read(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_booking_messages_read(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_booking_messages_read(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION mark_no_show(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_no_show(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_no_show(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_no_show(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_no_show(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION mark_partner_notifications_read(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_partner_notifications_read() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_partner_notifications_read() TO anon;
GRANT ALL ON FUNCTION public.mark_partner_notifications_read() TO authenticated;
GRANT ALL ON FUNCTION public.mark_partner_notifications_read() TO service_role;


--
-- Name: FUNCTION mark_support_read(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_support_read() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_support_read() TO anon;
GRANT ALL ON FUNCTION public.mark_support_read() TO authenticated;
GRANT ALL ON FUNCTION public.mark_support_read() TO service_role;


--
-- Name: FUNCTION mark_traveller_messages_read(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_traveller_messages_read(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_traveller_messages_read(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_traveller_messages_read(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_traveller_messages_read(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION my_owned_partner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_owned_partner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_owned_partner() TO anon;
GRANT ALL ON FUNCTION public.my_owned_partner() TO authenticated;
GRANT ALL ON FUNCTION public.my_owned_partner() TO service_role;


--
-- Name: FUNCTION my_pending_invites(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_pending_invites() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_pending_invites() TO anon;
GRANT ALL ON FUNCTION public.my_pending_invites() TO authenticated;
GRANT ALL ON FUNCTION public.my_pending_invites() TO service_role;


--
-- Name: FUNCTION new_ref_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.new_ref_code() TO anon;
GRANT ALL ON FUNCTION public.new_ref_code() TO authenticated;
GRANT ALL ON FUNCTION public.new_ref_code() TO service_role;


--
-- Name: FUNCTION normalise_code(p_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalise_code(p_code text) TO anon;
GRANT ALL ON FUNCTION public.normalise_code(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.normalise_code(p_code text) TO service_role;


--
-- Name: FUNCTION notify_partner_of_booking(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_partner_of_booking() TO anon;
GRANT ALL ON FUNCTION public.notify_partner_of_booking() TO authenticated;
GRANT ALL ON FUNCTION public.notify_partner_of_booking() TO service_role;


--
-- Name: FUNCTION notify_partner_of_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_partner_of_message() TO anon;
GRANT ALL ON FUNCTION public.notify_partner_of_message() TO authenticated;
GRANT ALL ON FUNCTION public.notify_partner_of_message() TO service_role;


--
-- Name: FUNCTION notify_partner_of_review(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_partner_of_review() TO anon;
GRANT ALL ON FUNCTION public.notify_partner_of_review() TO authenticated;
GRANT ALL ON FUNCTION public.notify_partner_of_review() TO service_role;


--
-- Name: FUNCTION notify_partner_of_support(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_partner_of_support() TO anon;
GRANT ALL ON FUNCTION public.notify_partner_of_support() TO authenticated;
GRANT ALL ON FUNCTION public.notify_partner_of_support() TO service_role;


--
-- Name: FUNCTION partner_address(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_address(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_address(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.partner_address(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.partner_address(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION partner_cancel_booking_item(p_item_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_cancel_booking_item(p_item_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_cancel_booking_item(p_item_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.partner_cancel_booking_item(p_item_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.partner_cancel_booking_item(p_item_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION partner_maps_url(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_maps_url(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_maps_url(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.partner_maps_url(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.partner_maps_url(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION partner_name(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.partner_name(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.partner_name(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.partner_name(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION partner_phone(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_phone(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_phone(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.partner_phone(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.partner_phone(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION partner_photo_path(p_partner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_photo_path(p_partner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_photo_path(p_partner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.partner_photo_path(p_partner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.partner_photo_path(p_partner_id uuid) TO service_role;


--
-- Name: FUNCTION partner_send_message(p_item_id uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_send_message(p_item_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_send_message(p_item_id uuid, p_body text) TO anon;
GRANT ALL ON FUNCTION public.partner_send_message(p_item_id uuid, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.partner_send_message(p_item_id uuid, p_body text) TO service_role;


--
-- Name: FUNCTION partner_team(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_team() FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_team() TO anon;
GRANT ALL ON FUNCTION public.partner_team() TO authenticated;
GRANT ALL ON FUNCTION public.partner_team() TO service_role;


--
-- Name: FUNCTION partner_wants_notification(p_partner_id uuid, p_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.partner_wants_notification(p_partner_id uuid, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.partner_wants_notification(p_partner_id uuid, p_kind text) TO anon;
GRANT ALL ON FUNCTION public.partner_wants_notification(p_partner_id uuid, p_kind text) TO authenticated;
GRANT ALL ON FUNCTION public.partner_wants_notification(p_partner_id uuid, p_kind text) TO service_role;


--
-- Name: FUNCTION recompute_listing_rating(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recompute_listing_rating() TO anon;
GRANT ALL ON FUNCTION public.recompute_listing_rating() TO authenticated;
GRANT ALL ON FUNCTION public.recompute_listing_rating() TO service_role;


--
-- Name: FUNCTION record_listing_view(p_kind text, p_subject text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_listing_view(p_kind text, p_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_listing_view(p_kind text, p_subject text) TO anon;
GRANT ALL ON FUNCTION public.record_listing_view(p_kind text, p_subject text) TO authenticated;
GRANT ALL ON FUNCTION public.record_listing_view(p_kind text, p_subject text) TO service_role;


--
-- Name: FUNCTION redeem_booking(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.redeem_booking(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.redeem_booking(p_code text) TO anon;
GRANT ALL ON FUNCTION public.redeem_booking(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.redeem_booking(p_code text) TO service_role;


--
-- Name: FUNCTION refund_booking(p_ref_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refund_booking(p_ref_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refund_booking(p_ref_code text) TO anon;
GRANT ALL ON FUNCTION public.refund_booking(p_ref_code text) TO authenticated;
GRANT ALL ON FUNCTION public.refund_booking(p_ref_code text) TO service_role;


--
-- Name: FUNCTION register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text) TO anon;
GRANT ALL ON FUNCTION public.register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text) TO authenticated;
GRANT ALL ON FUNCTION public.register_partner(p_name text, p_kind text, p_island_slug text, p_contact_phone text, p_address text, p_maps_url text) TO service_role;


--
-- Name: FUNCTION remove_partner_staff(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_partner_staff(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_partner_staff(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.remove_partner_staff(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.remove_partner_staff(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rental_load_on(p_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rental_load_on(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rental_load_on(p_date date) TO anon;
GRANT ALL ON FUNCTION public.rental_load_on(p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.rental_load_on(p_date date) TO service_role;


--
-- Name: FUNCTION reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date) TO anon;
GRANT ALL ON FUNCTION public.reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date) TO authenticated;
GRANT ALL ON FUNCTION public.reopen_partner_date(p_kind text, p_subject_id uuid, p_on_date date) TO service_role;


--
-- Name: FUNCTION reopen_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_partner_date_impl(p_kind text, p_subject_id uuid, p_on_date date) TO service_role;


--
-- Name: FUNCTION reply_to_review(p_review_id uuid, p_reply text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reply_to_review(p_review_id uuid, p_reply text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reply_to_review(p_review_id uuid, p_reply text) TO anon;
GRANT ALL ON FUNCTION public.reply_to_review(p_review_id uuid, p_reply text) TO authenticated;
GRANT ALL ON FUNCTION public.reply_to_review(p_review_id uuid, p_reply text) TO service_role;


--
-- Name: FUNCTION reply_to_review_impl(p_review_id uuid, p_reply text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reply_to_review_impl(p_review_id uuid, p_reply text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reply_to_review_impl(p_review_id uuid, p_reply text) TO service_role;


--
-- Name: FUNCTION resubmit_partner(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resubmit_partner() TO anon;
GRANT ALL ON FUNCTION public.resubmit_partner() TO authenticated;
GRANT ALL ON FUNCTION public.resubmit_partner() TO service_role;


--
-- Name: FUNCTION resubmit_partner_impl(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resubmit_partner_impl() FROM PUBLIC;
GRANT ALL ON FUNCTION public.resubmit_partner_impl() TO service_role;


--
-- Name: FUNCTION resubmit_partner_listing(p_kind text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resubmit_partner_listing(p_kind text, p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.resubmit_partner_listing(p_kind text, p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resubmit_partner_listing(p_kind text, p_id uuid) TO service_role;


--
-- Name: FUNCTION resubmit_partner_listing_impl(p_kind text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resubmit_partner_listing_impl(p_kind text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resubmit_partner_listing_impl(p_kind text, p_id uuid) TO service_role;


--
-- Name: FUNCTION revoke_partner_invite(p_invite_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_partner_invite(p_invite_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_partner_invite(p_invite_id uuid) TO anon;
GRANT ALL ON FUNCTION public.revoke_partner_invite(p_invite_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revoke_partner_invite(p_invite_id uuid) TO service_role;


--
-- Name: FUNCTION save_event_guests(p_ref_code text, p_guests jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_event_guests(p_ref_code text, p_guests jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_event_guests(p_ref_code text, p_guests jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_event_guests(p_ref_code text, p_guests jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_event_guests(p_ref_code text, p_guests jsonb) TO service_role;


--
-- Name: FUNCTION save_ferry_passengers(p_ref_code text, p_passengers jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_ferry_passengers(p_ref_code text, p_passengers jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_ferry_passengers(p_ref_code text, p_passengers jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_ferry_passengers(p_ref_code text, p_passengers jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_ferry_passengers(p_ref_code text, p_passengers jsonb) TO service_role;


--
-- Name: FUNCTION save_trip_travellers(p_ref_code text, p_travellers jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_trip_travellers(p_ref_code text, p_travellers jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_trip_travellers(p_ref_code text, p_travellers jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_trip_travellers(p_ref_code text, p_travellers jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_trip_travellers(p_ref_code text, p_travellers jsonb) TO service_role;


--
-- Name: FUNCTION send_support_message(p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_support_message(p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_support_message(p_body text) TO anon;
GRANT ALL ON FUNCTION public.send_support_message(p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.send_support_message(p_body text) TO service_role;


--
-- Name: FUNCTION set_car_routes(p_cab_id uuid, p_routes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_car_routes(p_cab_id uuid, p_routes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_car_routes(p_cab_id uuid, p_routes jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_car_routes(p_cab_id uuid, p_routes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_car_routes(p_cab_id uuid, p_routes jsonb) TO service_role;


--
-- Name: FUNCTION set_category_payment(p_kind text, p_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_category_payment(p_kind text, p_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_category_payment(p_kind text, p_mode text) TO anon;
GRANT ALL ON FUNCTION public.set_category_payment(p_kind text, p_mode text) TO authenticated;
GRANT ALL ON FUNCTION public.set_category_payment(p_kind text, p_mode text) TO service_role;


--
-- Name: FUNCTION set_commission_rate(p_kind text, p_bps integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_commission_rate(p_kind text, p_bps integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_commission_rate(p_kind text, p_bps integer) TO anon;
GRANT ALL ON FUNCTION public.set_commission_rate(p_kind text, p_bps integer) TO authenticated;
GRANT ALL ON FUNCTION public.set_commission_rate(p_kind text, p_bps integer) TO service_role;


--
-- Name: FUNCTION set_listing_photos(p_kind text, p_id uuid, p_paths text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_listing_photos(p_kind text, p_id uuid, p_paths text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_listing_photos(p_kind text, p_id uuid, p_paths text[]) TO anon;
GRANT ALL ON FUNCTION public.set_listing_photos(p_kind text, p_id uuid, p_paths text[]) TO authenticated;
GRANT ALL ON FUNCTION public.set_listing_photos(p_kind text, p_id uuid, p_paths text[]) TO service_role;


--
-- Name: FUNCTION set_my_email(p_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_email(p_email text) TO anon;
GRANT ALL ON FUNCTION public.set_my_email(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.set_my_email(p_email text) TO service_role;


--
-- Name: FUNCTION set_my_phone(p_phone text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_phone(p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_phone(p_phone text) TO anon;
GRANT ALL ON FUNCTION public.set_my_phone(p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.set_my_phone(p_phone text) TO service_role;


--
-- Name: FUNCTION set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb) TO service_role;


--
-- Name: FUNCTION set_partner_activity_schedule_impl(p_activity_id uuid, p_slots jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_activity_schedule_impl(p_activity_id uuid, p_slots jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_activity_schedule_impl(p_activity_id uuid, p_slots jsonb) TO service_role;


--
-- Name: FUNCTION set_partner_contact_phone(p_phone text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_contact_phone(p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_contact_phone(p_phone text) TO anon;
GRANT ALL ON FUNCTION public.set_partner_contact_phone(p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.set_partner_contact_phone(p_phone text) TO service_role;


--
-- Name: FUNCTION set_partner_contact_phone_impl(p_phone text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_contact_phone_impl(p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_contact_phone_impl(p_phone text) TO service_role;


--
-- Name: FUNCTION set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean) TO anon;
GRANT ALL ON FUNCTION public.set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_partner_notification_prefs(p_new_booking boolean, p_cancellation boolean, p_message boolean) TO service_role;


--
-- Name: FUNCTION set_partner_notification_prefs_impl(p_new_booking boolean, p_cancellation boolean, p_message boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_notification_prefs_impl(p_new_booking boolean, p_cancellation boolean, p_message boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_notification_prefs_impl(p_new_booking boolean, p_cancellation boolean, p_message boolean) TO service_role;


--
-- Name: FUNCTION set_partner_rental_hours(p_slots jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_rental_hours(p_slots jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_rental_hours(p_slots jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_partner_rental_hours(p_slots jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_partner_rental_hours(p_slots jsonb) TO service_role;


--
-- Name: FUNCTION set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb) TO service_role;


--
-- Name: FUNCTION set_partner_restaurant_tables_impl(p_restaurant_id uuid, p_slots jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_partner_restaurant_tables_impl(p_restaurant_id uuid, p_slots jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_partner_restaurant_tables_impl(p_restaurant_id uuid, p_slots jsonb) TO service_role;


--
-- Name: FUNCTION set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) TO anon;
GRANT ALL ON FUNCTION public.set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) TO authenticated;
GRANT ALL ON FUNCTION public.set_payout_account(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) TO service_role;


--
-- Name: FUNCTION set_payout_account_impl(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_payout_account_impl(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_payout_account_impl(p_account_name text, p_account_number text, p_ifsc text, p_upi_id text) TO service_role;


--
-- Name: FUNCTION set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer) TO anon;
GRANT ALL ON FUNCTION public.set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer) TO authenticated;
GRANT ALL ON FUNCTION public.set_vehicle_security_deposit(p_vehicle_id uuid, p_paise integer) TO service_role;


--
-- Name: FUNCTION subject_title(p_kind text, p_subject_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.subject_title(p_kind text, p_subject_id uuid) TO anon;
GRANT ALL ON FUNCTION public.subject_title(p_kind text, p_subject_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.subject_title(p_kind text, p_subject_id uuid) TO service_role;


--
-- Name: FUNCTION sync_availability(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_availability() TO anon;
GRANT ALL ON FUNCTION public.sync_availability() TO authenticated;
GRANT ALL ON FUNCTION public.sync_availability() TO service_role;


--
-- Name: FUNCTION traveller_send_message(p_item_id uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.traveller_send_message(p_item_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.traveller_send_message(p_item_id uuid, p_body text) TO anon;
GRANT ALL ON FUNCTION public.traveller_send_message(p_item_id uuid, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.traveller_send_message(p_item_id uuid, p_body text) TO service_role;


--
-- Name: FUNCTION undo_redeem_booking_item(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.undo_redeem_booking_item(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.undo_redeem_booking_item(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.undo_redeem_booking_item(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.undo_redeem_booking_item(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION unique_slug(p_base text, p_table text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unique_slug(p_base text, p_table text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unique_slug(p_base text, p_table text) TO anon;
GRANT ALL ON FUNCTION public.unique_slug(p_base text, p_table text) TO service_role;


--
-- Name: FUNCTION update_partner_activity(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_partner_activity(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_activity(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_activity(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_activity_impl(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_activity_impl(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_activity_impl(p_id uuid, p_name text, p_summary text, p_about text, p_price_paise integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_car(p_id uuid, p_category text, p_model text, p_seats integer, p_luggage integer, p_ac boolean, p_fuel text, p_board_number text, p_full_day_paise integer, p_airport_surcharge_paise integer, p_night_surcharge_paise integer, p_per_km_paise integer, p_per_min_paise integer, p_meta text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_event(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_age_restriction text, p_performer text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_event_impl(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_event_impl(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_event_impl(p_id uuid, p_name text, p_venue text, p_area text, p_on_date date, p_time_mins integer, p_entry_paise integer, p_capacity integer, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_profile(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_partner_profile(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_profile(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_profile(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) TO service_role;


--
-- Name: FUNCTION update_partner_profile_impl(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_profile_impl(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_profile_impl(p_address text, p_maps_url text, p_cover_photo_path text, p_license_number text, p_license_doc_path text) TO service_role;


--
-- Name: FUNCTION update_partner_restaurant(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_partner_restaurant(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_restaurant(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_restaurant(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_restaurant_impl(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_restaurant_impl(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_restaurant_impl(p_id uuid, p_name text, p_area text, p_price_tier integer, p_blurb text, p_about text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_sailing(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_partner_sailing(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_sailing(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_sailing(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_sailing_impl(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_sailing_impl(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_sailing_impl(p_id uuid, p_style_label text, p_dep_mins integer, p_duration_mins integer, p_fare_paise integer, p_capacity integer, p_days_of_week integer[], p_style_tone text, p_info text, p_info_warn boolean, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_trip(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_difficulty text, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_bring_list text[], p_meet_point text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_trip_impl(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_trip_impl(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_trip_impl(p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text, p_runs_on_days integer[], p_price_paise integer, p_deposit_paise integer, p_min_seats integer, p_seats_total integer, p_summary text, p_includes text[], p_meet_point text, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_vehicle(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_partner_vehicle(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO anon;
GRANT ALL ON FUNCTION public.update_partner_vehicle(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO authenticated;
GRANT ALL ON FUNCTION public.update_partner_vehicle(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION update_partner_vehicle_impl(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_partner_vehicle_impl(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_partner_vehicle_impl(p_id uuid, p_model text, p_rate_paise integer, p_seats integer, p_meta text, p_units integer, p_photo_path text) TO service_role;


--
-- Name: FUNCTION weather_close_partner(p_on_date date, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.weather_close_partner(p_on_date date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.weather_close_partner(p_on_date date, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.weather_close_partner(p_on_date date, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.weather_close_partner(p_on_date date, p_reason text) TO service_role;


--
-- Name: FUNCTION weather_close_partner_impl(p_on_date date, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.weather_close_partner_impl(p_on_date date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.weather_close_partner_impl(p_on_date date, p_reason text) TO service_role;


--
-- Name: TABLE activities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activities TO anon;
GRANT ALL ON TABLE public.activities TO authenticated;
GRANT ALL ON TABLE public.activities TO service_role;


--
-- Name: TABLE activity_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_schedule TO anon;
GRANT ALL ON TABLE public.activity_schedule TO authenticated;
GRANT ALL ON TABLE public.activity_schedule TO service_role;


--
-- Name: TABLE booking_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_items TO anon;
GRANT ALL ON TABLE public.booking_items TO authenticated;
GRANT ALL ON TABLE public.booking_items TO service_role;


--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bookings TO anon;
GRANT ALL ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;


--
-- Name: TABLE commission_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.commission_rates TO anon;
GRANT ALL ON TABLE public.commission_rates TO authenticated;
GRANT ALL ON TABLE public.commission_rates TO service_role;


--
-- Name: TABLE partners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partners TO anon;
GRANT ALL ON TABLE public.partners TO authenticated;
GRANT ALL ON TABLE public.partners TO service_role;


--
-- Name: TABLE admin_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_bookings TO anon;
GRANT ALL ON TABLE public.admin_bookings TO authenticated;
GRANT ALL ON TABLE public.admin_bookings TO service_role;


--
-- Name: TABLE reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reviews TO anon;
GRANT ALL ON TABLE public.reviews TO authenticated;
GRANT ALL ON TABLE public.reviews TO service_role;


--
-- Name: TABLE admin_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_reviews TO anon;
GRANT ALL ON TABLE public.admin_reviews TO authenticated;
GRANT ALL ON TABLE public.admin_reviews TO service_role;


--
-- Name: TABLE support_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_messages TO anon;
GRANT ALL ON TABLE public.support_messages TO authenticated;
GRANT ALL ON TABLE public.support_messages TO service_role;


--
-- Name: TABLE support_threads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_threads TO anon;
GRANT ALL ON TABLE public.support_threads TO authenticated;
GRANT ALL ON TABLE public.support_threads TO service_role;


--
-- Name: TABLE admin_support_threads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_support_threads TO anon;
GRANT ALL ON TABLE public.admin_support_threads TO authenticated;
GRANT ALL ON TABLE public.admin_support_threads TO service_role;


--
-- Name: TABLE admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admins TO anon;
GRANT ALL ON TABLE public.admins TO authenticated;
GRANT ALL ON TABLE public.admins TO service_role;


--
-- Name: TABLE availability; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.availability TO anon;
GRANT ALL ON TABLE public.availability TO authenticated;
GRANT ALL ON TABLE public.availability TO service_role;


--
-- Name: TABLE booking_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_messages TO anon;
GRANT ALL ON TABLE public.booking_messages TO authenticated;
GRANT ALL ON TABLE public.booking_messages TO service_role;


--
-- Name: TABLE cab_places; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cab_places TO anon;
GRANT ALL ON TABLE public.cab_places TO authenticated;
GRANT ALL ON TABLE public.cab_places TO service_role;


--
-- Name: TABLE cab_routes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cab_routes TO anon;
GRANT ALL ON TABLE public.cab_routes TO authenticated;
GRANT ALL ON TABLE public.cab_routes TO service_role;


--
-- Name: TABLE cab_trip_details; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cab_trip_details TO anon;
GRANT ALL ON TABLE public.cab_trip_details TO authenticated;
GRANT ALL ON TABLE public.cab_trip_details TO service_role;


--
-- Name: TABLE cabs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabs TO anon;
GRANT ALL ON TABLE public.cabs TO authenticated;
GRANT ALL ON TABLE public.cabs TO service_role;


--
-- Name: TABLE category_payment; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.category_payment TO anon;
GRANT ALL ON TABLE public.category_payment TO authenticated;
GRANT ALL ON TABLE public.category_payment TO service_role;


--
-- Name: TABLE event_guests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_guests TO anon;
GRANT ALL ON TABLE public.event_guests TO authenticated;
GRANT ALL ON TABLE public.event_guests TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE ferry_passengers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ferry_passengers TO anon;
GRANT ALL ON TABLE public.ferry_passengers TO authenticated;
GRANT ALL ON TABLE public.ferry_passengers TO service_role;


--
-- Name: TABLE islands; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.islands TO anon;
GRANT ALL ON TABLE public.islands TO authenticated;
GRANT ALL ON TABLE public.islands TO service_role;


--
-- Name: TABLE listing_closures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_closures TO anon;
GRANT ALL ON TABLE public.listing_closures TO authenticated;
GRANT ALL ON TABLE public.listing_closures TO service_role;


--
-- Name: TABLE listing_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_photos TO anon;
GRANT ALL ON TABLE public.listing_photos TO authenticated;
GRANT ALL ON TABLE public.listing_photos TO service_role;


--
-- Name: TABLE listing_views; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_views TO anon;
GRANT ALL ON TABLE public.listing_views TO authenticated;
GRANT ALL ON TABLE public.listing_views TO service_role;


--
-- Name: SEQUENCE listing_views_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.listing_views_id_seq TO anon;
GRANT ALL ON SEQUENCE public.listing_views_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.listing_views_id_seq TO service_role;


--
-- Name: TABLE my_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.my_bookings TO anon;
GRANT ALL ON TABLE public.my_bookings TO authenticated;
GRANT ALL ON TABLE public.my_bookings TO service_role;


--
-- Name: TABLE partner_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_users TO anon;
GRANT ALL ON TABLE public.partner_users TO authenticated;
GRANT ALL ON TABLE public.partner_users TO service_role;


--
-- Name: TABLE partner_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_bookings TO anon;
GRANT ALL ON TABLE public.partner_bookings TO authenticated;
GRANT ALL ON TABLE public.partner_bookings TO service_role;


--
-- Name: TABLE partner_cancellations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_cancellations TO anon;
GRANT ALL ON TABLE public.partner_cancellations TO authenticated;
GRANT ALL ON TABLE public.partner_cancellations TO service_role;


--
-- Name: TABLE partner_delivered; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_delivered TO anon;
GRANT ALL ON TABLE public.partner_delivered TO authenticated;
GRANT ALL ON TABLE public.partner_delivered TO service_role;


--
-- Name: TABLE partner_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_invites TO anon;
GRANT ALL ON TABLE public.partner_invites TO authenticated;
GRANT ALL ON TABLE public.partner_invites TO service_role;


--
-- Name: TABLE partner_notification_prefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_notification_prefs TO anon;
GRANT ALL ON TABLE public.partner_notification_prefs TO authenticated;
GRANT ALL ON TABLE public.partner_notification_prefs TO service_role;


--
-- Name: TABLE partner_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_notifications TO anon;
GRANT ALL ON TABLE public.partner_notifications TO authenticated;
GRANT ALL ON TABLE public.partner_notifications TO service_role;


--
-- Name: TABLE partner_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_reviews TO anon;
GRANT ALL ON TABLE public.partner_reviews TO authenticated;
GRANT ALL ON TABLE public.partner_reviews TO service_role;


--
-- Name: TABLE partner_view_counts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_view_counts TO anon;
GRANT ALL ON TABLE public.partner_view_counts TO authenticated;
GRANT ALL ON TABLE public.partner_view_counts TO service_role;


--
-- Name: TABLE payout_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payout_accounts TO anon;
GRANT ALL ON TABLE public.payout_accounts TO authenticated;
GRANT ALL ON TABLE public.payout_accounts TO service_role;


--
-- Name: TABLE rental_hours; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_hours TO anon;
GRANT ALL ON TABLE public.rental_hours TO authenticated;
GRANT ALL ON TABLE public.rental_hours TO service_role;


--
-- Name: TABLE restaurant_tables; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.restaurant_tables TO anon;
GRANT ALL ON TABLE public.restaurant_tables TO authenticated;
GRANT ALL ON TABLE public.restaurant_tables TO service_role;


--
-- Name: TABLE restaurants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.restaurants TO anon;
GRANT ALL ON TABLE public.restaurants TO authenticated;
GRANT ALL ON TABLE public.restaurants TO service_role;


--
-- Name: TABLE sailings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sailings TO anon;
GRANT ALL ON TABLE public.sailings TO authenticated;
GRANT ALL ON TABLE public.sailings TO service_role;


--
-- Name: TABLE traveller_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.traveller_profiles TO anon;
GRANT ALL ON TABLE public.traveller_profiles TO authenticated;
GRANT ALL ON TABLE public.traveller_profiles TO service_role;


--
-- Name: TABLE trip_travellers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trip_travellers TO anon;
GRANT ALL ON TABLE public.trip_travellers TO authenticated;
GRANT ALL ON TABLE public.trip_travellers TO service_role;


--
-- Name: TABLE trips; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trips TO anon;
GRANT ALL ON TABLE public.trips TO authenticated;
GRANT ALL ON TABLE public.trips TO service_role;


--
-- Name: TABLE vehicles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicles TO anon;
GRANT ALL ON TABLE public.vehicles TO authenticated;
GRANT ALL ON TABLE public.vehicles TO service_role;


--
-- Name: TABLE waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waitlist TO anon;
GRANT ALL ON TABLE public.waitlist TO authenticated;
GRANT ALL ON TABLE public.waitlist TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict rLOh3vEwNjqvIhUaWcpbLN17evGw1PlDvoIdgqf8TRbTUyL4exDO3btaWLCc6jS

