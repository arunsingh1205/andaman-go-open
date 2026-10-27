-- Trips: fixed meeting point vs hotel pickup (2026-09-11).
--
-- A day trip either meets travellers at a fixed spot (today's behaviour, a
-- free-text meet_point) or the host collects each traveller from wherever
-- they're staying. Until now the second case had no structure — one partner
-- just typed "From your Hotel" into meet_point, leaving the host with no idea
-- which hotel any booking was at.
--
-- This adds:
--   * trips.meet_at_hotel        — true => the host picks travellers up from
--     their accommodation; meet_point is stored as '' and not shown.
--   * trips.maps_url             — an optional Google Maps pin for the fixed
--     meeting point, so "Directions" works (same idea as events, 071).
--   * booking_items.pickup_address — the traveller's stay address, captured at
--     booking time for a hotel-pickup trip (null otherwise).
--
-- The three trip writers (add_partner_trip / update_partner_trip from 074,
-- admin_update_trip from 075) each gain p_meet_at_hotel and p_maps_url;
-- save_trip_travellers (056) gains p_hotel_address. subject_address /
-- subject_maps_url (071) grow a 'trip' branch. Signatures change, so each
-- function is dropped and recreated then re-granted — same discipline as 074.

alter table trips
  add column if not exists meet_at_hotel boolean not null default false;

alter table trips
  add column if not exists maps_url text;

alter table booking_items
  add column if not exists pickup_address text;


-- ===========================================================================
-- add_partner_trip — + p_meet_at_hotel, p_maps_url
-- ===========================================================================

drop function if exists
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[]);
drop function if exists
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean);

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
  p_maps_url text default null
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
    departs_mins, run_dates, meet_at_hotel, maps_url
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_difficulty, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), coalesce(p_bring_list, '{}'),
    case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    false, p_photo_path,
    p_departs_mins, coalesce(p_run_dates, '{}'), coalesce(p_meet_at_hotel, false),
    nullif(trim(p_maps_url), '')
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text) from public;
grant execute on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text)
  to authenticated;


-- ===========================================================================
-- update_partner_trip — + p_meet_at_hotel, p_maps_url
-- ===========================================================================

drop function if exists
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[]);
drop function if exists
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean);

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
  p_maps_url text default null
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
    meet_point = case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    meet_at_hotel = coalesce(p_meet_at_hotel, false),
    maps_url = nullif(trim(p_maps_url), ''),
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
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text) from public;
grant execute on function
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text, int, date[], boolean, text)
  to authenticated;


-- ===========================================================================
-- admin_update_trip — + p_meet_at_hotel, p_maps_url
-- ===========================================================================

drop function if exists
  admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[]);
drop function if exists
  admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean);

create or replace function admin_update_trip(
  p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text,
  p_runs_on_days int[], p_price_paise int, p_difficulty text, p_min_seats int,
  p_seats_total int, p_summary text, p_includes text[], p_bring_list text[],
  p_meet_point text, p_departs_mins int, p_run_dates date[],
  p_meet_at_hotel boolean default false, p_maps_url text default null
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
    meet_point = case when coalesce(p_meet_at_hotel, false) then '' else trim(p_meet_point) end,
    meet_at_hotel = coalesce(p_meet_at_hotel, false),
    maps_url = nullif(trim(p_maps_url), ''),
    departs_mins = p_departs_mins,
    run_dates = coalesce(p_run_dates, '{}')
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean, text) from public;
grant execute on function admin_update_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, int, date[], boolean, text) to authenticated;


-- ===========================================================================
-- save_trip_travellers — + p_hotel_address, stored on booking_items
-- ===========================================================================

drop function if exists save_trip_travellers(text, jsonb);

create or replace function save_trip_travellers(p_ref_code text, p_travellers jsonb, p_hotel_address text default null)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_item    uuid;
  v_party   int;
  v_subject uuid;
  v_hotel   boolean;
  t         jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party, i.subject_id into v_item, v_party, v_subject
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

  select meet_at_hotel into v_hotel from trips where id = v_subject;
  if coalesce(v_hotel, false) and coalesce(trim(p_hotel_address), '') = '' then
    return query select false, 'Tell the host where you''re staying so they can pick you up.'::text;
    return;
  end if;

  delete from trip_travellers where booking_item_id = v_item;

  insert into trip_travellers (booking_item_id, full_name, age)
  select v_item, trim(t->>'fullName'), (t->>'age')::int
  from jsonb_array_elements(p_travellers) as t;

  update booking_items set pickup_address = nullif(trim(p_hotel_address), '') where id = v_item;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_trip_travellers(text, jsonb, text) from public;
grant execute on function save_trip_travellers(text, jsonb, text) to authenticated;


-- ===========================================================================
-- subject_address / subject_maps_url (071) — teach them about trips, so the
-- traveller's bookings-list "Directions" button resolves a trip's fixed
-- meeting point and pin. A hotel-pickup trip has meet_point '' / maps_url null,
-- which falls through to the partner profile — harmless, the button is only
-- shown when there's a real place to go.
-- ===========================================================================

create or replace function subject_address(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(address), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(address), '') from restaurants where id = p_subject_id)
      when 'trip'     then (select nullif(trim(meet_point), '') from trips     where id = p_subject_id)
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
      when 'trip'     then (select nullif(trim(maps_url), '') from trips       where id = p_subject_id)
    end,
    partner_maps_url(p_partner_id)
  )
$$;

revoke all on function subject_address(text, uuid, uuid)  from public;
revoke all on function subject_maps_url(text, uuid, uuid) from public;
grant execute on function subject_address(text, uuid, uuid)  to authenticated, anon;
grant execute on function subject_maps_url(text, uuid, uuid) to authenticated, anon;


select 'trip hotel pickup installed' as done;
