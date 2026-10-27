-- ===========================================================================
-- Migration 053 — who's actually going, and more from the partner up front
--
-- Two gaps the redesigned Events screen exposed:
--
-- 1. An RSVP was just a headcount. Real doors check a name, and pricing for
--    a family event isn't "N people x entry price" — a small child doesn't
--    take a ticket. The rule this migration encodes: everyone OVER age 3
--    needs a ticket (counted for capacity, charged the entry price); age 3
--    and under is free and doesn't consume a spot. `event_guests` is one row
--    per attendee (name + age), same shape as `ferry_passengers` (039), and
--    `save_event_guests` is its RPC, called right after create_booking the
--    same way `save_ferry_passengers` is — see bookEvent() in lib/book.ts.
--    create_booking itself needs no change: p_party already means "tickets",
--    the traveller-facing form just now computes that number from ages
--    instead of asking for it directly.
--
-- 2. The partner event form asked the same six fields no matter what kind of
--    night it was. Two additions: age_restriction (every event states one —
--    a bonfire and an 18+ DJ night aren't the same door policy) and performer
--    (who's playing — required for 'dj' and 'live', meaningless for a
--    'bonfire' or 'karaoke' open mic, so the RPC only demands it for those
--    two genres).
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. events grows two columns.
-- ---------------------------------------------------------------------------

alter table events
  add column if not exists age_restriction text not null default 'all-ages'
    check (age_restriction in ('all-ages', '18+', '21+'));
alter table events
  add column if not exists performer text;


-- ---------------------------------------------------------------------------
-- 2. event_guests — one row per attendee on an event booking_item.
-- ---------------------------------------------------------------------------

create table if not exists event_guests (
  id              uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references booking_items(id) on delete cascade,
  full_name       text not null,
  age             int  not null check (age between 0 and 120),
  created_at      timestamptz not null default now()
);

create index if not exists event_guests_item_idx on event_guests (booking_item_id);

alter table event_guests enable row level security;

drop policy if exists "own event guests" on event_guests;
create policy "own event guests" on event_guests
  for select using (
    exists (
      select 1
      from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = event_guests.booking_item_id
        and b.user_id = auth.uid()
    )
  );

-- The partner runs the door themselves for an event (unlike a ferry, which
-- has no operator API yet), so they see who's on the list.
drop policy if exists "partner sees own event guests" on event_guests;
create policy "partner sees own event guests" on event_guests
  for select using (
    exists (
      select 1
      from booking_items i
      join partner_users pu on pu.partner_id = i.partner_id
      where i.id = event_guests.booking_item_id
        and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all event guests" on event_guests;
create policy "admins see all event guests" on event_guests
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 3. save_event_guests — called right after create_booking, with the ref it
--    returned and the full attendee list (including free-entry kids). The
--    number of over-3s in the list has to match the party the booking was
--    already priced and seated for, or the list doesn't match what was paid.
-- ---------------------------------------------------------------------------

create or replace function save_event_guests(p_ref_code text, p_guests jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function save_event_guests(text, jsonb) from public;
grant execute on function save_event_guests(text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. add_partner_event / update_partner_event grow age_restriction and
--    performer. Dropped and recreated (not create-or-replace) since the
--    parameter list changes.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_event(text, text, text, text, date, int, int, int, text, text);

create or replace function add_partner_event(
  p_genre           text,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null
) returns table (ok boolean, message text, event_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
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

revoke all on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text) from public;
grant execute on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text)
  to authenticated;


drop function if exists update_partner_event(uuid, text, text, text, date, int, int, int, text, text);

create or replace function update_partner_event(
  p_id              uuid,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
  v_genre      text;
begin
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

revoke all on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text) from public;
grant execute on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text)
  to authenticated;


select 'event guests and per-event details ready' as done;
