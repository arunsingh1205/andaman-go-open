-- Trip schedule: a pickup time, and one-off dates (2026-09-11).
--
-- Until now a day trip could only say WHICH WEEKDAYS it runs (trips.runs_on_days),
-- and every booking was recorded at a hard-coded 6 AM (lib/trips.ts). Two gaps:
--
--   1. No departure / pickup time. Hosts want to tell travellers when to show up.
--   2. No way to run a trip on a one-off date — Christmas, New Year, a charter —
--      rather than a weekly recurrence.
--
-- This adds:
--   * trips.departs_mins  — minutes from IST midnight. Default 360 (6 AM) keeps
--     every existing row behaving exactly as before.
--   * trips.run_dates     — one-off dates. Empty  => weekly (use runs_on_days).
--                           Non-empty => the trip runs only on those dates and
--                           runs_on_days is ignored. The array's emptiness IS
--                           the mode, so there is no separate flag column.
--
-- add_partner_trip / update_partner_trip (last touched in 058) gain the two
-- params. The old signature is dropped and the new one created-or-replaced
-- (so a second run of this file is a no-op, not a "function already exists"
-- error), then re-granted — same discipline as 056.

alter table trips add column if not exists departs_mins int not null default 360;
alter table trips add column if not exists run_dates   date[] not null default '{}';

alter table trips drop constraint if exists trips_departs_mins_check;
alter table trips add  constraint trips_departs_mins_check
  check (departs_mins >= 0 and departs_mins < 1440);


-- ===========================================================================
-- add_partner_trip — + p_departs_mins, p_run_dates
-- ===========================================================================

drop function if exists
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text);

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
  p_run_dates date[] default '{}'
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
  if p_departs_mins is null or p_departs_mins < 0 or p_departs_mins >= 1440 then
    return query select false, 'Choose a valid pickup time.'::text, null::uuid;
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
    departs_mins, run_dates
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_difficulty, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), coalesce(p_bring_list, '{}'),
    trim(p_meet_point), false, p_photo_path,
    p_departs_mins, coalesce(p_run_dates, '{}')
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[]) from public;
grant execute on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[])
  to authenticated;


-- ===========================================================================
-- update_partner_trip — + p_departs_mins, p_run_dates
-- ===========================================================================

drop function if exists
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text);

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
  p_run_dates date[] default '{}'
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
    departs_mins = p_departs_mins,
    run_dates = coalesce(p_run_dates, '{}'),
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
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[]) from public;
grant execute on function
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[])
  to authenticated;


select 'trip schedule times installed' as done;
