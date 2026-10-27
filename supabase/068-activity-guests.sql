-- ===========================================================================
-- Migration 068 — activity_guests: who is actually on the dive
--
-- Activities were the last paid, seat-based category that recorded a headcount
-- and nothing else. A trip (056, trip_travellers) and an event (053,
-- event_guests) both know who is coming; a ferry (039, ferry_passengers) knows
-- that plus their ID. An activity operator running a scuba slot had a party
-- number and the in-app message thread, and that was it.
--
-- activity_guests is the same shape and RLS as trip_travellers — one row per
-- seat, name + age, no free-age carve-out since every seat on an activity is a
-- full guest — and save_activity_guests is called right after create_booking
-- exactly the way save_trip_travellers is (see bookActivity() in lib/book.ts).
-- create_booking itself needs no change.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. activity_guests — one row per seat on an activity booking_item. Same
--    shape and RLS as trip_travellers (056): guest sees their own, the
--    operator sees their own bookings' rows, admins see everything.
-- ---------------------------------------------------------------------------

create table if not exists activity_guests (
  id              uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references booking_items(id) on delete cascade,
  full_name       text not null,
  age             int  not null check (age between 0 and 120),
  created_at      timestamptz not null default now()
);

create index if not exists activity_guests_item_idx on activity_guests (booking_item_id);

alter table activity_guests enable row level security;

drop policy if exists "own activity guests" on activity_guests;
create policy "own activity guests" on activity_guests
  for select using (
    exists (
      select 1
      from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = activity_guests.booking_item_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists "partner sees own activity guests" on activity_guests;
create policy "partner sees own activity guests" on activity_guests
  for select using (
    exists (
      select 1
      from booking_items i
      join partner_users pu on pu.partner_id = i.partner_id
      where i.id = activity_guests.booking_item_id
        and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all activity guests" on activity_guests;
create policy "admins see all activity guests" on activity_guests
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 2. save_activity_guests — called right after create_booking, with the ref
--    it returned and one {fullName, age} per seat. The count has to match the
--    item's party exactly — an activity seat has no free-rider case.
-- ---------------------------------------------------------------------------

create or replace function save_activity_guests(p_ref_code text, p_guests jsonb)
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
    and i.kind = 'activity'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That activity booking could not be found.'::text;
    return;
  end if;

  if p_guests is null or jsonb_typeof(p_guests) <> 'array'
     or jsonb_array_length(p_guests) <> v_party then
    return query select false, format('Enter details for all %s guests.', v_party)::text;
    return;
  end if;

  for t in select * from jsonb_array_elements(p_guests) loop
    if coalesce(trim(t->>'fullName'), '') = '' then
      return query select false, 'Every guest needs a name.'::text;
      return;
    end if;
    if (t->>'age') is null or (t->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every guest.'::text;
      return;
    end if;
  end loop;

  delete from activity_guests where booking_item_id = v_item;

  insert into activity_guests (booking_item_id, full_name, age)
  select v_item, trim(elem->>'fullName'), (elem->>'age')::int
  from jsonb_array_elements(p_guests) as elem;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_activity_guests(text, jsonb) from public;
grant execute on function save_activity_guests(text, jsonb) to authenticated;


select 'activities: guest list ready' as done;
