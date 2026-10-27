-- ===========================================================================
-- Migration 021 — a partner can close a date
--
-- The schedule behind a listing is a TEMPLATE: activity_schedule says "we run
-- at 9 AM on these weekdays", trips.runs_on_days says "Tue, Thu, Sat". Neither
-- can say "...except this Thursday, the sea's too rough."
-- activity_schedule.closed_reason closes a time slot on EVERY day, not one
-- date. So a dive shop with a storm coming had no lever short of un-listing
-- the whole activity — which also loses them their place in search.
--
-- listing_closures is that lever. One row = "this listing, this date, shut,
-- here's why." It is read by the traveller-facing catalogue (public select,
-- exactly like `availability`) so a closed day shows as closed instead of
-- bookable, and it is checked once more inside create_booking() so a stale
-- page open in someone's browser can't slip a booking through.
--
-- SCOPE: activities and trips only — the boat-based, weather-exposed kinds a
-- partner actually needs this for. Restaurants, stays, rentals, ferries and
-- events are a later slice; each needs its own read-path wiring, and the
-- `kind` check below is deliberately tight so nothing writes a closure we
-- don't yet honour on read.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The closures.
-- ---------------------------------------------------------------------------

create table if not exists listing_closures (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  kind        text not null check (kind in ('activity', 'trip')),
  -- The listing's own id (activities.id / trips.id). Not an FK — same reason
  -- booking_items.subject_id isn't one: the kind tells you the table.
  subject_id  uuid not null,
  -- The IST calendar day being closed.
  on_date     date not null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  unique (kind, subject_id, on_date)
);

-- The unique constraint's index already covers the catalogue read
-- (kind + subject_id + on_date) and create_booking's point lookup. This one
-- is for "show me my closures" and the on delete cascade from partners.
create index if not exists listing_closures_partner_idx
  on listing_closures (partner_id);

alter table listing_closures enable row level security;

-- Public to read, same as availability's "counts are public" — a closed date
-- is operational fact the catalogue has to see, logged out or not. No insert/
-- update/delete policy: every write goes through the SECURITY DEFINER RPCs
-- below, which check the caller owns the listing.
drop policy if exists "closures are public" on listing_closures;
create policy "closures are public" on listing_closures for select using (true);

grant select on listing_closures to anon, authenticated;


-- ---------------------------------------------------------------------------
-- close_partner_date / reopen_partner_date — one listing, one date.
--
-- Same discipline as every partner write since 011: look the caller's
-- partner_id up from partner_users, never trust the client; a hardcoded
-- branch per kind rather than dynamic SQL off client input; a reason
-- required at the database level for anything a traveller will read.
-- ---------------------------------------------------------------------------

create or replace function close_partner_date(
  p_kind text,
  p_subject_id uuid,
  p_on_date date,
  p_reason text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function close_partner_date(text, uuid, date, text) from public;
grant execute on function close_partner_date(text, uuid, date, text) to authenticated;


create or replace function reopen_partner_date(
  p_kind text,
  p_subject_id uuid,
  p_on_date date
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function reopen_partner_date(text, uuid, date) from public;
grant execute on function reopen_partner_date(text, uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- weather_close_partner — shut every activity and trip for one date at once.
--
-- Weather on the Andamans doesn't pick one boat. This is the "storm coming,
-- we're all off tomorrow" button: one closure row per listing the partner
-- has, same reason on each. Reopening is still per-listing (or the partner
-- re-runs this with each one).
-- ---------------------------------------------------------------------------

create or replace function weather_close_partner(
  p_on_date date,
  p_reason text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function weather_close_partner(date, text) from public;
grant execute on function weather_close_partner(date, text) to authenticated;


-- ---------------------------------------------------------------------------
-- create_booking — the backstop.
--
-- Whole body is migration 008's, unchanged, except the one marked block:
-- create_replace needs the full function. A closed date raises before any
-- seat is held; the catalogue should already have hidden the slot, so a
-- traveller only hits this from a page that was open before the partner
-- closed it.
-- ---------------------------------------------------------------------------

create or replace function create_booking(
  p_kind      text,
  p_subject   text,
  p_starts_at timestamptz,
  p_party     int  default 1,
  p_units     int  default 1,
  p_variant   text default null,
  p_extras    boolean default false
)
returns table (ref_code text, ticket_code text, price_paise int, state text)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_subject_id uuid;
  v_partner_id uuid;
  v_island     text;
  v_price      int;
  v_capacity   int;
  v_taken      int;
  v_needed     int := p_party;
  v_state      text;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
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
      select p.id, p.id, p.island_slug,
             v.rate_paise * p_units + case when p_extras then 10000 else 0 end,
             null
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from partners p
      join vehicles v on v.partner_id = p.id and v.code = p_variant and v.is_listed
      where p.slug = p_subject and p.status = 'approved';

    when 'stay' then
      select s.id, s.partner_id, s.island_slug, s.price_paise * p_units, null
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from stays s
      where s.slug = p_subject and s.is_listed;

    else
      raise exception 'unknown booking kind "%"', p_kind using errcode = '22023';
  end case;

  if v_subject_id is null then
    raise exception 'nothing bookable found for % "%"', p_kind, p_subject using errcode = '22023';
  end if;

  -- >>> 021: the operator has closed this date (weather, private charter, a
  -- day off). Only activities and trips can carry a closure today.
  if exists (
    select 1 from listing_closures
    where kind = p_kind and subject_id = v_subject_id and on_date = v_day
  ) then
    raise exception 'that date is closed to bookings' using errcode = 'P0001';
  end if;
  -- <<< 021

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

  v_state := case when p_kind in ('activity', 'trip', 'rental') then 'pending' else 'confirmed' end;

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

  v_ticket := case
    when v_state = 'confirmed'
    then v_ref || '-' || upper(left(p_kind, 1))
    else null
  end;

  insert into booking_items
    (booking_id, kind, subject_id, partner_id, starts_at, party, price_paise, state, ticket_code)
  values
    (v_booking, p_kind, v_subject_id, v_partner_id, p_starts_at, p_party, v_price, v_state, v_ticket);

  return query select v_ref, v_ticket, v_price, v_state;
end $$;

revoke all on function create_booking(text, text, timestamptz, int, int, text, boolean) from public;
grant execute on function create_booking(text, text, timestamptz, int, int, text, boolean)
  to authenticated, anon;


-- Check: the table answers.
select count(*) as listing_closures_rows from listing_closures;
