-- ===========================================================================
-- Migration 056 — Island Adventures: full payment, travellers, listing detail
--
-- Three gaps the "Trips by locals" → "Island Adventures" redesign exposed:
--
-- 1. Trips were the only "choice" category left where a host also runs a
--    minimum-group-size trip that can fall through (min_seats) — a deposit
--    made sense when a no-show risk was being hedged per traveller. Now the
--    platform takes the full amount up front and settles with the host on
--    payout, same as ferry/event/stay already do (034). category_payment
--    flips to 'full', and deposit_paise — never read for anything but that
--    now-gone toggle — comes off the table and both partner RPCs.
--
-- 2. A trip booking recorded a seat count and nothing else, unlike an event
--    (053, event_guests) or a ferry (039, ferry_passengers), both of which
--    know who is actually going. trip_travellers is the same shape as
--    event_guests — one row per seat, name + age, no free-age carve-out
--    since every seat on a trip is a full traveller — and
--    save_trip_travellers is called right after create_booking exactly the
--    way save_event_guests is (see bookTrip() in lib/book.ts).
--
-- 3. The partner trip form asked for everything except what a traveller
--    deciding between two full-day outdoor trips actually wants to know:
--    how physical it is, and what to bring. difficulty and bring_list add
--    that, the same restrained way 053 added age_restriction/performer to
--    events.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Trips are paid in full from here on.
-- ---------------------------------------------------------------------------

update category_payment set mode = 'full', updated_at = now() where kind = 'trip';


-- ---------------------------------------------------------------------------
-- 2. trips: deposit_paise retires, difficulty and bring_list arrive.
-- ---------------------------------------------------------------------------

alter table trips drop column if exists deposit_paise;

alter table trips
  add column if not exists difficulty text not null default 'moderate'
    check (difficulty in ('easy', 'moderate', 'challenging'));
alter table trips
  add column if not exists bring_list text[] not null default '{}';


-- ---------------------------------------------------------------------------
-- 3. trip_travellers — one row per seat on a trip booking_item. Same shape
--    and RLS as event_guests (053): traveller sees their own, the host sees
--    their own bookings' rows, admins see everything.
-- ---------------------------------------------------------------------------

create table if not exists trip_travellers (
  id              uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references booking_items(id) on delete cascade,
  full_name       text not null,
  age             int  not null check (age between 0 and 120),
  created_at      timestamptz not null default now()
);

create index if not exists trip_travellers_item_idx on trip_travellers (booking_item_id);

alter table trip_travellers enable row level security;

drop policy if exists "own trip travellers" on trip_travellers;
create policy "own trip travellers" on trip_travellers
  for select using (
    exists (
      select 1
      from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = trip_travellers.booking_item_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists "partner sees own trip travellers" on trip_travellers;
create policy "partner sees own trip travellers" on trip_travellers
  for select using (
    exists (
      select 1
      from booking_items i
      join partner_users pu on pu.partner_id = i.partner_id
      where i.id = trip_travellers.booking_item_id
        and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all trip travellers" on trip_travellers;
create policy "admins see all trip travellers" on trip_travellers
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 4. save_trip_travellers — called right after create_booking, with the ref
--    it returned and one {fullName, age} per seat. The count has to match
--    the item's party exactly — a trip seat has no free-rider case.
-- ---------------------------------------------------------------------------

create or replace function save_trip_travellers(p_ref_code text, p_travellers jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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
  select v_item, trim(elem->>'fullName'), (elem->>'age')::int
  from jsonb_array_elements(p_travellers) as elem;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_trip_travellers(text, jsonb) from public;
grant execute on function save_trip_travellers(text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. add_partner_trip / update_partner_trip — deposit_paise param out,
--    difficulty and bring_list in. Dropped and recreated, not
--    create-or-replaced: the parameter list changes.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_trip(text, text, text, text, int[], int, int, int, int, text, text[], text, text);

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

revoke all on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text) from public;
grant execute on function
  add_partner_trip(text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text)
  to authenticated;


drop function if exists update_partner_trip(uuid, text, text, text, text, int[], int, int, int, int, text, text[], text, text);

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

revoke all on function
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text) from public;
grant execute on function
  update_partner_trip(uuid, text, text, text, text, int[], int, text, int, int, text, text[], text[], text, text)
  to authenticated;


select 'trips: full payment, travellers, difficulty and bring list ready' as done;
