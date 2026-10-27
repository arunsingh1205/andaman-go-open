-- Round 4: partners can set their own timetable for an activity, and their
-- own table slots for a restaurant, instead of Arun inserting
-- activity_schedule / restaurant_tables rows by hand after every self-serve
-- listing. That manual step was the one gap left once 011 and 016 covered
-- adding and editing the listings themselves — a self-served activity or
-- restaurant was approvable, but not bookable, until Arun wrote its
-- timetable in by SQL.
--
-- Both tables already exist in schema.sql with RLS enabled and a "catalogue
-- is public" select policy (travellers' own booking pages already read
-- them). This migration only adds two write RPCs — same
-- lookup-caller's-own-partner-id, SECURITY DEFINER pattern as every other
-- partner-facing write since 011.
--
-- Deliberately NOT tied to the "editing a live listing flips it back to
-- pending" rule 013 established: a schedule is operational (hours,
-- capacity, temporarily-closed) rather than content Andaman Go would want
-- to re-review, and 004's booking-availability queries never gated on
-- anything but the listing's own is_listed — so is_listed and
-- rejection_reason are untouched here.
--
-- Each call replaces the whole timetable for one listing in a single
-- transaction (delete + re-insert) rather than editing individual rows,
-- since the editor always submits the full set of slots.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Activities: replace an activity's activity_schedule rows.
--
-- p_slots is a jsonb array of
--   { "time_mins": int, "capacity": int, "days_of_week": int[], "closed_reason": text|null }
-- matching activity_schedule's own columns one for one.
-- ---------------------------------------------------------------------------

create or replace function set_partner_activity_schedule(
  p_activity_id uuid,
  p_slots jsonb
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function set_partner_activity_schedule(uuid, jsonb) from public;
grant execute on function set_partner_activity_schedule(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Restaurants: replace a restaurant's restaurant_tables rows.
--
-- p_slots is a jsonb array of
--   { "time_mins": int, "table_count": int, "seats_per_table": int }
-- days_of_week isn't exposed here — lib/restaurants.ts reads tonight's
-- tables without ever filtering by it, so a per-slot day picker would look
-- like it does something it doesn't. Every row gets the column's own
-- default (every day) same as before this migration.
-- ---------------------------------------------------------------------------

create or replace function set_partner_restaurant_tables(
  p_restaurant_id uuid,
  p_slots jsonb
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

  insert into restaurant_tables (restaurant_id, time_mins, table_count, seats_per_table)
  select
    p_restaurant_id,
    (s->>'time_mins')::int,
    (s->>'table_count')::int,
    coalesce((s->>'seats_per_table')::int, 4)
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Table slots saved.'::text;
end;
$$;

revoke all on function set_partner_restaurant_tables(uuid, jsonb) from public;
grant execute on function set_partner_restaurant_tables(uuid, jsonb) to authenticated;
