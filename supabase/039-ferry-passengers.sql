-- ===========================================================================
-- Migration 039 — ferry passenger details, and the government ferry retires
--
-- A real Andaman ferry ticket (Makruzz, Nautika, Green Ocean) carries every
-- passenger's name exactly as on the photo ID they'll show at the jetty, plus
-- age, gender, nationality and the ID number — the operator prints them and
-- checks them at boarding. The app collected none of that: it booked a ferry
-- with a party count and nothing else.
--
-- This adds `ferry_passengers` (one row per passenger on a ferry booking_item)
-- and the RPC the booking flow calls to fill it. There is no operator API yet,
-- so a paid ferry booking has no ticket_code until someone books it with the
-- operator and records the PNR — admin_place_ferry_booking is that step.
--
-- The government STARS ferry comes off the list here (is_listed = false on its
-- one sailing). Makruzz, Nautika and Green Ocean stay.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The government ferry retires.
-- ---------------------------------------------------------------------------

update sailings set is_listed = false where code = 'gov';


-- ---------------------------------------------------------------------------
-- 2. ferry_passengers — one row per person on a ferry booking_item.
-- ---------------------------------------------------------------------------

create table if not exists ferry_passengers (
  id              uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references booking_items(id) on delete cascade,
  full_name       text not null,
  age             int  not null check (age between 0 and 120),
  gender          text not null check (gender in ('male','female','other')),
  nationality     text not null default 'Indian',
  id_type         text not null check (id_type in ('aadhaar','passport','driving-licence')),
  id_number       text not null,
  created_at      timestamptz not null default now()
);

create index if not exists ferry_passengers_item_idx
  on ferry_passengers (booking_item_id);

alter table ferry_passengers enable row level security;

drop policy if exists "own ferry passengers" on ferry_passengers;
create policy "own ferry passengers" on ferry_passengers
  for select using (
    exists (
      select 1
      from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = ferry_passengers.booking_item_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all ferry passengers" on ferry_passengers;
create policy "admins see all ferry passengers" on ferry_passengers
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 3. save_ferry_passengers — the booking flow calls this right after
--    create_booking, with the ref it got back and the passenger list. Replaces
--    any existing rows so a retry is safe.
-- ---------------------------------------------------------------------------

create or replace function save_ferry_passengers(p_ref_code text, p_passengers jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function save_ferry_passengers(text, jsonb) from public;
grant execute on function save_ferry_passengers(text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_place_ferry_booking — the admin has booked it with the operator
--    and is recording the PNR / ticket reference.
-- ---------------------------------------------------------------------------

create or replace function admin_place_ferry_booking(p_item_id uuid, p_pnr text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function admin_place_ferry_booking(uuid, text) from public;
grant execute on function admin_place_ferry_booking(uuid, text) to authenticated;


select 'ferry passengers ready; government ferry retired' as done;
