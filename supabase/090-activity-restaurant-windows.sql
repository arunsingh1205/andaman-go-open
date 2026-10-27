-- ===========================================================================
-- Migration 090 — activities and restaurants get a "window" schedule mode
--
-- Today a partner enters one row per exact departure/seating time
-- (activity_schedule.time_mins / restaurant_tables.time_mins), each with a
-- mandatory capacity. That is high-friction busywork for a partner who just
-- runs "9 to 2, walk-ins welcome" — they shouldn't have to invent a list of
-- hourly times or guess a capacity number just to get listed.
--
-- This adds an optional `end_time_mins` to both activity_schedule and
-- restaurant_tables. A row with end_time_mins null keeps behaving exactly as
-- it does today (an exact time). A row with end_time_mins set is a WINDOW —
-- lib/activities.ts / lib/restaurants.ts (application code, not this
-- migration) expand it into bookable instants every 30 minutes between
-- time_mins and end_time_mins, each carrying the row's own capacity
-- independently (a window's capacity, when set, caps each generated instant,
-- not the window as a shared pool — this reuses the existing per-instant
-- availability bookkeeping unchanged).
--
-- Activities keep exact-time entry available as an explicit opt-in
-- ("fixed" mode) for listings that genuinely need it (e.g. a dive boat with
-- two fixed departures) — a new activities.schedule_mode column records the
-- choice. Existing activities default to 'fixed' (their rows have no
-- end_time_mins yet, so nothing about them changes); new activities default
-- to 'window'. Restaurants get no such toggle — the redesigned partner UI
-- only ever writes window rows for restaurants, though a restaurant's
-- pre-existing fixed-time rows (end_time_mins null) keep reading and booking
-- exactly as before until a partner re-saves through the new editor.
--
-- Bundled into the same migration: capacity/table_count become properly
-- optional inside these RPCs (089 already relaxed the column constraints;
-- this teaches set_partner_activity_schedule_impl,
-- set_partner_restaurant_tables_impl, admin_set_activity_schedule and
-- admin_set_restaurant_tables to accept a blank capacity as "uncapped"
-- instead of rejecting it) — bundled rather than a separate migration since
-- it touches the exact same function bodies as the window-mode change.
--
-- Safe to run more than once.
-- ===========================================================================

alter table activity_schedule add column if not exists end_time_mins int;
alter table activity_schedule drop constraint if exists activity_schedule_window_check;
alter table activity_schedule add constraint activity_schedule_window_check
  check (end_time_mins is null or (end_time_mins between 0 and 1439 and end_time_mins > time_mins));

alter table restaurant_tables add column if not exists end_time_mins int;
alter table restaurant_tables drop constraint if exists restaurant_tables_window_check;
alter table restaurant_tables add constraint restaurant_tables_window_check
  check (end_time_mins is null or (end_time_mins between 0 and 1439 and end_time_mins > time_mins));

alter table activities add column if not exists schedule_mode text not null default 'fixed';
alter table activities drop constraint if exists activities_schedule_mode_check;
alter table activities add constraint activities_schedule_mode_check
  check (schedule_mode in ('window', 'fixed'));
-- Every existing activity is backfilled to 'fixed' by the default above
-- (their rows have no end_time_mins, so behaviour is unchanged). Only now do
-- we flip the column default, so a newly created activity opens into window
-- mode per the product decision.
alter table activities alter column schedule_mode set default 'window';


-- ---------------------------------------------------------------------------
-- set_partner_activity_schedule_impl (renamed from set_partner_activity_schedule
-- by 027's _owner_wrap_prepare; the owner-checked wrapper at that public name
-- already calls this and does not need to change).
--
-- p_slots entries: { "time_mins": int, "end_time_mins": int|null,
--   "capacity": int|null, "days_of_week": int[], "closed_reason": text|null }
-- ---------------------------------------------------------------------------

create or replace function set_partner_activity_schedule_impl(
  p_activity_id uuid,
  p_slots jsonb
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_end_time_mins int;
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
    v_end_time_mins := nullif(v_slot->>'end_time_mins', '')::int;
    v_capacity := nullif(v_slot->>'capacity', '')::int;

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each slot needs a valid time.'::text;
      return;
    end if;
    if v_end_time_mins is not null
       and (v_end_time_mins < 0 or v_end_time_mins > 1439 or v_end_time_mins <= v_time_mins) then
      return query select false, 'A window''s end time must be after its start time.'::text;
      return;
    end if;
    if v_capacity is not null and v_capacity <= 0 then
      return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two slots have the same start time — give each one a different time.'::text;
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

  insert into activity_schedule (activity_id, time_mins, end_time_mins, capacity, days_of_week, closed_reason)
  select
    p_activity_id,
    (s->>'time_mins')::int,
    nullif(s->>'end_time_mins', '')::int,
    nullif(s->>'capacity', '')::int,
    (select array_agg(distinct x::int) from jsonb_array_elements_text(s->'days_of_week') x),
    nullif(trim(s->>'closed_reason'), '')
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Schedule saved.'::text;
end;
$$;

revoke all on function set_partner_activity_schedule_impl(uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- set_partner_activity_mode — switches a listing between window and fixed
-- entry. Kept separate from the schedule-save RPC above since toggling the
-- mode is a distinct partner action from editing the rows (the UI needs to
-- know which row editor to show before the partner starts editing rows).
-- ---------------------------------------------------------------------------

create or replace function set_partner_activity_mode(p_activity_id uuid, p_mode text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_mode not in ('window', 'fixed') then
    return query select false, 'Unknown schedule mode.'::text;
    return;
  end if;

  update activities set schedule_mode = p_mode
  where id = p_activity_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_activity_mode(uuid, text) from public;
grant execute on function set_partner_activity_mode(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- set_partner_restaurant_tables_impl (renamed from set_partner_restaurant_tables
-- by 027's _owner_wrap_prepare; the owner-checked wrapper is unchanged).
--
-- p_slots entries: { "time_mins": int, "end_time_mins": int|null,
--   "table_count": int|null, "seats_per_table": int, "days_of_week": int[] }
-- ---------------------------------------------------------------------------

create or replace function set_partner_restaurant_tables_impl(
  p_restaurant_id uuid,
  p_slots jsonb
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_end_time_mins int;
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
    return query select false, 'Add at least one open period.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one open period.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many rows — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_time_mins := (v_slot->>'time_mins')::int;
    v_end_time_mins := nullif(v_slot->>'end_time_mins', '')::int;
    v_table_count := nullif(v_slot->>'table_count', '')::int;
    v_seats_per_table := coalesce((v_slot->>'seats_per_table')::int, 4);

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each row needs a valid opening time.'::text;
      return;
    end if;
    if v_end_time_mins is not null
       and (v_end_time_mins < 0 or v_end_time_mins > 1439 or v_end_time_mins <= v_time_mins) then
      return query select false, 'The closing time must be after the opening time.'::text;
      return;
    end if;
    if v_table_count is not null and v_table_count <= 0 then
      return query select false, 'Table count has to be greater than zero, or left blank for no limit.'::text;
      return;
    end if;
    if v_seats_per_table <= 0 then
      return query select false, 'Each row needs at least one seat per table.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two rows start at the same time — give each one a different time.'::text;
      return;
    end if;
    v_seen_times := array_append(v_seen_times, v_time_mins);
  end loop;

  delete from restaurant_tables where restaurant_id = p_restaurant_id;

  insert into restaurant_tables
    (restaurant_id, time_mins, end_time_mins, table_count, seats_per_table, days_of_week)
  select
    p_restaurant_id,
    (s->>'time_mins')::int,
    nullif(s->>'end_time_mins', '')::int,
    nullif(s->>'table_count', '')::int,
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

  return query select true, 'Hours saved.'::text;
end;
$$;

revoke all on function set_partner_restaurant_tables_impl(uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Admin mirrors (075) — same relaxed validation + end_time_mins, plus the new
-- admin_set_activity_mode.
-- ---------------------------------------------------------------------------

create or replace function admin_set_activity_schedule(p_activity_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_end_time_mins int;
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
    v_end_time_mins := nullif(v_slot->>'end_time_mins', '')::int;
    v_capacity := nullif(v_slot->>'capacity', '')::int;

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each slot needs a valid time.'::text;
      return;
    end if;
    if v_end_time_mins is not null
       and (v_end_time_mins < 0 or v_end_time_mins > 1439 or v_end_time_mins <= v_time_mins) then
      return query select false, 'A window''s end time must be after its start time.'::text;
      return;
    end if;
    if v_capacity is not null and v_capacity <= 0 then
      return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two slots have the same start time — give each one a different time.'::text;
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

  insert into activity_schedule (activity_id, time_mins, end_time_mins, capacity, days_of_week, closed_reason)
  select
    p_activity_id,
    (s->>'time_mins')::int,
    nullif(s->>'end_time_mins', '')::int,
    nullif(s->>'capacity', '')::int,
    (select array_agg(distinct x::int) from jsonb_array_elements_text(s->'days_of_week') x),
    nullif(trim(s->>'closed_reason'), '')
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Schedule saved.'::text;
end $$;

revoke all on function admin_set_activity_schedule(uuid, jsonb) from public;
grant execute on function admin_set_activity_schedule(uuid, jsonb) to authenticated;


create or replace function admin_set_activity_mode(p_activity_id uuid, p_mode text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_mode not in ('window', 'fixed') then
    return query select false, 'Unknown schedule mode.'::text;
    return;
  end if;

  update activities set schedule_mode = p_mode where id = p_activity_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_activity_mode(uuid, text) from public;
grant execute on function admin_set_activity_mode(uuid, text) to authenticated;


create or replace function admin_set_restaurant_tables(p_restaurant_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_end_time_mins int;
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
    return query select false, 'Add at least one open period.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one open period.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many rows — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_time_mins := (v_slot->>'time_mins')::int;
    v_end_time_mins := nullif(v_slot->>'end_time_mins', '')::int;
    v_table_count := nullif(v_slot->>'table_count', '')::int;
    v_seats_per_table := coalesce((v_slot->>'seats_per_table')::int, 4);

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each row needs a valid opening time.'::text;
      return;
    end if;
    if v_end_time_mins is not null
       and (v_end_time_mins < 0 or v_end_time_mins > 1439 or v_end_time_mins <= v_time_mins) then
      return query select false, 'The closing time must be after the opening time.'::text;
      return;
    end if;
    if v_table_count is not null and v_table_count <= 0 then
      return query select false, 'Table count has to be greater than zero, or left blank for no limit.'::text;
      return;
    end if;
    if v_seats_per_table <= 0 then
      return query select false, 'Each row needs at least one seat per table.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two rows start at the same time — give each one a different time.'::text;
      return;
    end if;
    v_seen_times := array_append(v_seen_times, v_time_mins);
  end loop;

  delete from restaurant_tables where restaurant_id = p_restaurant_id;

  insert into restaurant_tables
    (restaurant_id, time_mins, end_time_mins, table_count, seats_per_table, days_of_week)
  select
    p_restaurant_id,
    (s->>'time_mins')::int,
    nullif(s->>'end_time_mins', '')::int,
    nullif(s->>'table_count', '')::int,
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

  return query select true, 'Hours saved.'::text;
end $$;

revoke all on function admin_set_restaurant_tables(uuid, jsonb) from public;
grant execute on function admin_set_restaurant_tables(uuid, jsonb) to authenticated;


select 'activity/restaurant window scheduling installed' as done;
