-- ===========================================================================
-- Migration 035 — a rental shop has a finite fleet and opening hours
--
-- create_booking() has never checked rental stock. Its own comment admits it:
-- "Stock is not modelled yet, so there is no capacity check — the shop
-- confirming is what holds the vehicle." 034 removed the confirming step, so
-- now nothing holds the vehicle at all — a shop with three scooters could take
-- thirty bookings for Saturday.
--
-- This migration gives rentals what activities have had since 004: a real
-- ceiling, checked and written in the same transaction so two people tapping
-- the last scooter can't both win. It's shaped differently because a rental
-- spans DAYS, not a single slot — a scooter out Fri–Sun is unavailable on
-- each of those days — so the check is a peak-overlap count, not one row in
-- `availability`.
--
-- It also adds two things the partner owns and nobody else touches:
--   * vehicles.security_deposit_paise — the cash bond the shop takes at the
--     counter, in its own hands. The app only DISPLAYS it.
--   * rental_hours — the weekday windows the shop hands vehicles over in, so
--     pick-up isn't hard-coded to 9 AM for everyone.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The security deposit. Partner-set, partner-held, display-only in the app.
--
-- Its own one-argument RPC rather than another parameter threaded through the
-- add_/update_partner_vehicle _impl + owner-wrapper layering (011/013/027):
-- the deposit is a number a shop tunes on its own, not part of the listing
-- Andaman Go reviews.
-- ---------------------------------------------------------------------------

alter table vehicles
  add column if not exists security_deposit_paise int not null default 0
    check (security_deposit_paise >= 0);


create or replace function set_vehicle_security_deposit(p_vehicle_id uuid, p_paise int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function set_vehicle_security_deposit(uuid, int) from public;
grant execute on function set_vehicle_security_deposit(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. rental_hours — when the shop is open to hand a vehicle over.
--
-- One row per weekday the shop opens (0 = Sunday, matching days_of_week
-- everywhere else). No row for a day = closed that day. Public select, same
-- reasoning as restaurant_tables: the booking screen needs it to build the
-- pick-up time picker. Writes go through the RPC, which looks the caller's
-- partner up rather than trusting the client — the 011/017 pattern.
-- ---------------------------------------------------------------------------

create table if not exists rental_hours (
  partner_id  uuid not null references partners(id) on delete cascade,
  dow         int  not null check (dow between 0 and 6),
  open_mins   int  not null check (open_mins between 0 and 1439),
  close_mins  int  not null check (close_mins between 0 and 1439),
  primary key (partner_id, dow),
  check (open_mins < close_mins)
);

alter table rental_hours enable row level security;

drop policy if exists "rental hours are public" on rental_hours;
create policy "rental hours are public" on rental_hours for select using (true);

grant select on rental_hours to anon, authenticated;


-- Replace the whole set for one shop in a single transaction — the editor
-- always submits every open day, same as set_partner_restaurant_tables (017).
-- p_slots is a jsonb array of { "dow": int, "open_mins": int, "close_mins": int }.
create or replace function set_partner_rental_hours(p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
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

revoke all on function set_partner_rental_hours(jsonb) from public;
grant execute on function set_partner_rental_hours(jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. listing_closures learns about rentals.
--
-- 021 built close_partner_date / reopen_partner_date for activities and trips
-- and left the door open: "Restaurants, stays, rentals … are a later slice;
-- each needs its own read-path wiring." Rentals get theirs now. A rental's
-- subject_id is the partner's own id, exactly as create_booking treats it.
-- ---------------------------------------------------------------------------

alter table listing_closures drop constraint if exists listing_closures_kind_check;
alter table listing_closures add constraint listing_closures_kind_check
  check (kind in ('activity', 'trip', 'rental'));


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
-- 4. rental_load — how many of each vehicle are out on a given day.
--
-- The catalogue needs this to grey out a sold-out vehicle before anyone taps
-- Book. Numbers only, no traveller data — one row per (vehicle, day) that has
-- at least one vehicle out.
--
-- Unlike my_bookings this is DELIBERATELY not security_invoker: it has to read
-- past booking_items' "your own rows only" RLS the same way the public
-- `availability` table does, because a logged-out traveller must be able to
-- see that a scooter is sold out. It exposes counts and a vehicle id, nothing
-- that ties to a person — the same trade `availability` already makes.
-- ---------------------------------------------------------------------------

create or replace view rental_load
with (security_invoker = false) as
select
  i.variant_id,
  (i.starts_at at time zone 'Asia/Kolkata')::date + g.n as on_date,
  count(*) as out_count
from booking_items i
cross join lateral generate_series(0, i.units - 1) as g(n)
where i.kind = 'rental'
  and i.variant_id is not null
  and i.state in ('pending', 'confirmed', 'disrupted', 'completed')
group by i.variant_id, (i.starts_at at time zone 'Asia/Kolkata')::date + g.n;

grant select on rental_load to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. create_booking — the rental branch gets a real ceiling.
--
-- Whole body is 034's, with one marked block added: >>> 035. For a rental it
-- now (a) checks the pick-up time against rental_hours, and (b) takes an
-- advisory lock on the vehicle model and counts the peak day-overlap across
-- the rental's span, refusing the booking if it would put the fleet over the
-- top. Everything else — the price lookup, the closure check, the activity
-- seat lock — is untouched.
-- ---------------------------------------------------------------------------

create or replace function create_booking(
  p_kind      text,
  p_subject   text,
  p_starts_at timestamptz,
  p_party     int  default 1,
  p_units     int  default 1,
  p_variant   text default null,
  p_extras    boolean default false,
  p_pay_mode  text default 'full'
)
returns table (
  ref_code text, ticket_code text, price_paise int, state text,
  paid_online_paise int, balance_paise int
)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_subject_id uuid;
  v_partner_id uuid;
  v_variant_id uuid;
  v_stock      int;                                                 -- >>> 035
  v_peak       int;                                                 -- >>> 035
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

  -- 021: the operator has closed this date.
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

  -- >>> 035: a rental spans days and has a finite fleet.
  if p_kind = 'rental' then
    -- The shop's hours for that weekday, when it has set any.
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

    -- Serialise bookings for this one vehicle model, then count the busiest
    -- day the new rental would touch. There is no `availability` row to lock
    -- for a rental, so the advisory lock is what stops two people taking the
    -- last scooter at once.
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
  -- <<< 035

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

  v_ticket := v_ref || '-' || upper(left(p_kind, 1));

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

revoke all on function
  create_booking(text, text, timestamptz, int, int, text, boolean, text) from public;
grant execute on function
  create_booking(text, text, timestamptz, int, int, text, boolean, text)
  to authenticated, anon;


-- Check: the new table and view answer.
select count(*) as rental_hours_rows from rental_hours;
select count(*) as rental_load_rows from rental_load;
