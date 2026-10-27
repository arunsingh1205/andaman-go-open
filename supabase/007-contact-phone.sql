-- ===========================================================================
-- Migration 007 — where to send the ticket
--
-- A phone number is not identity here. It is an address. The whole product
-- promise runs through it: the confirmation, "your 6:20 ferry is cancelled,
-- here is the 11:00", the operator's fifteen minutes to accept. None of that
-- reaches anybody without a number.
--
-- So it is collected as part of booking rather than as a sign-up, and it is
-- stored in two places on purpose:
--
--   traveller_profiles.phone  — the current number, for reaching this person
--   bookings.contact_phone    — the number at the time of that booking
--
-- The copy matters. Change your number in March and the February booking must
-- still show where that ticket actually went, because that is the record a
-- support conversation gets resolved with.
--
-- OTP verification comes later and changes nothing here: it only decides
-- whether we believe the number, not where it is kept.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists traveller_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  phone       text,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table traveller_profiles enable row level security;

drop policy if exists "own profile" on traveller_profiles;
create policy "own profile" on traveller_profiles
  for select using (auth.uid() = user_id);

alter table bookings add column if not exists contact_phone text;


-- ---------------------------------------------------------------------------
-- set_my_phone — save a number, and attach it to bookings already made.
--
-- Somebody books, then gives their number on the confirmation screen. That
-- booking is seconds old and has no number on it yet, so it gets one. Older
-- bookings that already recorded a number keep it.
-- ---------------------------------------------------------------------------

create or replace function set_my_phone(p_phone text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_clean text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Keep the digits and a leading +. An Indian mobile typed without a country
  -- code is the common case, so give it one rather than rejecting it.
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a phone number' using errcode = '22023';
  end if;

  insert into traveller_profiles (user_id, phone)
  values (v_user, v_clean)
  on conflict (user_id) do update set phone = excluded.phone;

  -- Backfill this person's bookings that never got a number.
  update bookings
  set contact_phone = v_clean
  where user_id = v_user and contact_phone is null;

  return v_clean;
end $$;

revoke all on function set_my_phone(text) from public;
grant execute on function set_my_phone(text) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- New bookings pick up the number already on file.
--
-- Only the one line marked below is new; the rest is 004 unchanged, because
-- create_replace needs the whole body.
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

    -- NEW: the number already on file, copied onto this booking.
    select phone into v_phone from traveller_profiles where user_id = v_user;

    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone)
    values (v_ref, v_user, v_island, v_day, v_phone)
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


-- Check: nobody has a number yet, which is the point of the next screen.
select count(*) as profiles, count(phone) as with_phone from traveller_profiles;
