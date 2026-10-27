-- ===========================================================================
-- Migration 157 — an event can repeat on a weekday pattern through an end
-- date, instead of needing one listing per night
--
-- Until now events.on_date was a single date — a DJ night that runs every
-- night for a month meant the partner creating 30 separate listings by
-- hand. events gains two nullable-in-spirit columns:
--
--   * recur_days int[] not null default '{}' — which weekdays (0=Sun..6=Sat)
--     it repeats on. Empty means "just the once", exactly today's behaviour.
--   * recur_until date — the last date it runs, inclusive. Only meaningful
--     when recur_days is non-empty; checked to be >= on_date.
--
-- on_date stays as the FIRST night either way. This deliberately isn't
-- trips' runs_on_days/run_dates pair (016/074): a trip recurs indefinitely
-- and the traveller always books "whichever's next"; an event's run is
-- bounded (a residency, a festival month) and a traveller picks a specific
-- night from it, so a start date, a weekday pattern and a hard end date is
-- the shape that actually matches "every night this month."
--
-- add_partner_event / update_partner_event / admin_update_event each gain
-- two new trailing params (p_recur_days, p_recur_until) — following this
-- codebase's convention (071, 076, 092) for a parameter-list change, the old
-- signature is dropped first so CREATE OR REPLACE doesn't just add a second
-- overload PostgREST can no longer disambiguate.
--
-- create_booking's 'event' branch now matches either the single on_date (a
-- one-off event, same as before) or any date between on_date and
-- recur_until whose weekday is in recur_days — same 11-arg signature as
-- 153, so that one function is a plain CREATE OR REPLACE.
--
-- Safe to run more than once.
-- ===========================================================================

alter table events
  add column if not exists recur_days int[] not null default '{}',
  add column if not exists recur_until date;

alter table events drop constraint if exists events_recur_days_check;
alter table events add constraint events_recur_days_check
  check (recur_days <@ array[0,1,2,3,4,5,6]);

alter table events drop constraint if exists events_recur_until_check;
alter table events add constraint events_recur_until_check
  check (cardinality(recur_days) = 0 or (recur_until is not null and recur_until >= on_date));


-- ---------------------------------------------------------------------------
-- add_partner_event — + p_recur_days, p_recur_until.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_event(
  text, text, text, text, date, int, int, int, text, text, text, text, text, text, int
);

create function add_partner_event(
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
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null,
  p_end_time_mins   int  default null,
  p_recur_days      int[] default '{}',
  p_recur_until     date default null
) returns table (ok boolean, message text, event_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_genre not in ('dj', 'live', 'bonfire', 'karaoke', 'comedy', 'drama', 'festival', 'carnival', 'cruise') then
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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text, null::uuid;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text, null::uuid;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text, null::uuid;
    return;
  end if;
  if p_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text, null::uuid;
    return;
  end if;
  if not (coalesce(p_recur_days, '{}') <@ array[0,1,2,3,4,5,6]) then
    return query select false, 'Choose valid days of the week.'::text, null::uuid;
    return;
  end if;
  if cardinality(coalesce(p_recur_days, '{}')) > 0 then
    if p_recur_until is null then
      return query select false, 'Choose the last night it runs.'::text, null::uuid;
      return;
    end if;
    if p_recur_until < p_on_date then
      return query select false, 'The last night can''t be before the first.'::text, null::uuid;
      return;
    end if;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  if coalesce(trim(p_island_slug), '') <> '' then
    if not exists (select 1 from islands where slug = p_island_slug) then
      return query select false, 'Choose a valid island.'::text, null::uuid;
      return;
    end if;
    v_island := trim(p_island_slug);
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, end_time_mins, entry_paise, capacity, rating, reviews, about,
    age_restriction, performer, maps_url, is_listed, photo_path, recur_days, recur_until
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_end_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''),
    p_age_restriction, nullif(trim(p_performer), ''), nullif(trim(p_maps_url), ''), false, p_photo_path,
    coalesce(p_recur_days, '{}'),
    case when cardinality(coalesce(p_recur_days, '{}')) > 0 then p_recur_until else null end
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_event(
  text, text, text, text, date, int, int, int, text, text, text, text, text, text, int, int[], date
) from public;
grant execute on function add_partner_event(
  text, text, text, text, date, int, int, int, text, text, text, text, text, text, int, int[], date
) to authenticated;


-- ---------------------------------------------------------------------------
-- update_partner_event — + p_recur_days, p_recur_until.
-- ---------------------------------------------------------------------------

drop function if exists update_partner_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, text, int
);

create function update_partner_event(
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
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null,
  p_end_time_mins   int  default null,
  p_recur_days      int[] default '{}',
  p_recur_until     date default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
  v_genre      text;
begin
  perform assert_partner_owner();

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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;
  if not (coalesce(p_recur_days, '{}') <@ array[0,1,2,3,4,5,6]) then
    return query select false, 'Choose valid days of the week.'::text;
    return;
  end if;
  if cardinality(coalesce(p_recur_days, '{}')) > 0 then
    if p_recur_until is null then
      return query select false, 'Choose the last night it runs.'::text;
      return;
    end if;
    if p_recur_until < p_on_date then
      return query select false, 'The last night can''t be before the first.'::text;
      return;
    end if;
  end if;

  select is_listed, genre into v_was_listed, v_genre
  from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), ''),
    photo_path = p_photo_path,
    recur_days = coalesce(p_recur_days, '{}'),
    recur_until = case when cardinality(coalesce(p_recur_days, '{}')) > 0 then p_recur_until else null end,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, text, int, int[], date
) from public;
grant execute on function update_partner_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, text, int, int[], date
) to authenticated;


-- ---------------------------------------------------------------------------
-- admin_update_event — + p_recur_days, p_recur_until.
-- ---------------------------------------------------------------------------

drop function if exists admin_update_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, int
);

create function admin_update_event(
  p_id uuid, p_name text, p_venue text, p_area text, p_on_date date,
  p_time_mins int, p_entry_paise int, p_capacity int, p_about text,
  p_age_restriction text, p_performer text, p_island_slug text, p_maps_url text,
  p_end_time_mins int default null,
  p_recur_days int[] default '{}',
  p_recur_until date default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_genre text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

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
  if p_capacity is not null and p_capacity < 1 then
    return query select false, 'Capacity has to be greater than zero, or left blank for no limit.'::text;
    return;
  end if;
  if p_end_time_mins is not null and p_end_time_mins not between 0 and 1439 then
    return query select false, 'Enter a valid end time.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;
  if not (coalesce(p_recur_days, '{}') <@ array[0,1,2,3,4,5,6]) then
    return query select false, 'Choose valid days of the week.'::text;
    return;
  end if;
  if cardinality(coalesce(p_recur_days, '{}')) > 0 then
    if p_recur_until is null then
      return query select false, 'Choose the last night it runs.'::text;
      return;
    end if;
    if p_recur_until < p_on_date then
      return query select false, 'The last night can''t be before the first.'::text;
      return;
    end if;
  end if;

  select genre into v_genre from events where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    end_time_mins = p_end_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), ''),
    recur_days = coalesce(p_recur_days, '{}'),
    recur_until = case when cardinality(coalesce(p_recur_days, '{}')) > 0 then p_recur_until else null end
  where id = p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, int, int[], date
) from public;
grant execute on function admin_update_event(
  uuid, text, text, text, date, int, int, int, text, text, text, text, text, int, int[], date
) to authenticated;


-- ---------------------------------------------------------------------------
-- create_booking — same 11-arg signature as 153, so CREATE OR REPLACE is
-- safe. Only the 'event' branch's WHERE clause changes: match either the
-- single on_date (a one-off event) or any date in [on_date, recur_until]
-- whose weekday is in recur_days.
-- ---------------------------------------------------------------------------

create or replace function create_booking(
  p_kind text,
  p_subject text,
  p_starts_at timestamptz,
  p_party int default 1,
  p_units int default 1,
  p_variant text default null,
  p_extras boolean default false,
  p_pay_mode text default 'full',
  p_razorpay_order_id text default null,
  p_razorpay_payment_id text default null,
  p_delivery_hotel text default null
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
  v_stock      int;
  v_peak       int;
  v_island     text;
  v_price      int;
  v_delivery   int := 0;
  v_capacity   int;
  v_taken      int;
  v_party      int := p_party;
  v_needed     int := p_party;
  v_ticket_lbl text;
  v_mode       text;
  v_bps        int;
  v_deposit    int;
  v_paid       int;
  v_balance    int;
  v_state      text;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
  v_kind_seq   int;
  v_phone      text;
  v_email      text;
  v_day        date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_time_mins  int  := extract(hour from p_starts_at at time zone 'Asia/Kolkata') * 60
                     + extract(minute from p_starts_at at time zone 'Asia/Kolkata');
  v_dow        int  := extract(dow from (p_starts_at at time zone 'Asia/Kolkata'))::int;
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

  if p_kind = 'rental' and p_extras and coalesce(trim(p_delivery_hotel), '') = '' then
    raise exception 'a hotel name is required for delivery' using errcode = '22023';
  end if;

  if p_razorpay_payment_id is not null then
    select b.ref_code, bi.ticket_code, bi.price_paise, bi.state,
           bi.paid_online_paise, bi.balance_paise
      into v_ref, v_ticket, v_price, v_state, v_paid, v_balance
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where bi.razorpay_payment_id = p_razorpay_payment_id;

    if found then
      return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
      return;
    end if;
  end if;

  if p_kind in ('activity', 'ferry', 'event', 'trip', 'rental')
     and p_starts_at <= now() + interval '2 hours' then
    raise exception 'booking window closed for this time' using errcode = 'P0001';
  end if;

  case p_kind

    when 'activity' then
      select a.id, a.partner_id, a.island_slug, a.price_paise * p_party, s.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from activities a
      join activity_schedule s on s.activity_id = a.id
        and v_dow = any (s.days_of_week)
        and (
          (s.end_time_mins is null and s.time_mins = v_time_mins)
          or (
            s.end_time_mins is not null
            and v_time_mins between s.time_mins and s.end_time_mins
            and mod(v_time_mins - s.time_mins, 30) = 0
          )
        )
      where a.slug = p_subject and a.is_listed;

    when 'ferry' then
      select s.id, s.partner_id, s.to_island, s.fare_paise * p_party, s.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from sailings s
      where s.code = p_subject and s.is_listed and s.dep_mins = v_time_mins;

    when 'event' then
      -- A one-off event (recur_days empty) still matches only its exact
      -- on_date, same as always. A recurring one matches any date from
      -- on_date through recur_until whose weekday is in recur_days —
      -- lib/events.ts never offers a p_starts_at outside that window, but
      -- this is the actual enforcement, the same way listing_closures and
      -- the capacity check below are, not the read side.
      select e.id, e.partner_id, e.island_slug, e.entry_paise * p_party, e.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from events e
      where e.slug = p_subject and e.is_listed
        and (
          (cardinality(e.recur_days) = 0 and e.on_date = v_day)
          or (
            cardinality(e.recur_days) > 0
            and v_day between e.on_date and coalesce(e.recur_until, e.on_date)
            and v_dow = any (e.recur_days)
          )
        );

      -- An event with passes is booked by pass: p_variant is the pass id,
      -- p_units how many of them. The price and the seats it takes come from
      -- the pass row here, never from the client.
      if v_subject_id is not null
         and exists (select 1 from event_tickets where event_id = v_subject_id) then
        if p_variant is null then
          raise exception 'choose a ticket type' using errcode = '22023';
        end if;
        if p_units > 20 then
          raise exception 'party or units out of range' using errcode = '22023';
        end if;

        select t.name, t.price_paise * p_units, t.people * p_units
          into v_ticket_lbl, v_price, v_party
        from event_tickets t
        where t.event_id = v_subject_id and t.id::text = p_variant;

        if v_ticket_lbl is null then
          raise exception 'that ticket type is no longer offered' using errcode = '22023';
        end if;
        v_needed := v_party;
      end if;

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

      v_delivery := case when p_extras then 10000 else 0 end;

    else
      raise exception 'unknown booking kind "%"', p_kind using errcode = '22023';
  end case;

  if v_subject_id is null then
    raise exception 'nothing bookable found for % "%"', p_kind, p_subject using errcode = '22023';
  end if;

  if v_price > 0 and p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

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

  if p_kind = 'rental' then
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

  select mode into v_mode from category_payment where kind = p_kind;
  v_mode := coalesce(v_mode, 'full');

  if p_pay_mode not in ('full', 'deposit') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;
  if p_pay_mode = 'deposit' and v_mode <> 'choice' then
    raise exception 'this booking has to be paid in full' using errcode = '22023';
  end if;

  select commission_bps into v_bps from partners where id = v_partner_id;
  v_deposit := round((v_price - v_delivery) * coalesce(v_bps, 3000) / 10000.0)::int;
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

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = p_kind;

  v_ticket := v_ref || '-' || upper(left(p_kind, 1))
            || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, variant_id, partner_id, starts_at,
     party, units, price_paise, delivery_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at, razorpay_order_id, razorpay_payment_id,
     pickup_address, ticket_label)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     v_party, p_units, v_price, v_delivery, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id,
     case when p_kind = 'rental' and p_extras then trim(p_delivery_hotel) else null end,
     v_ticket_lbl);

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;

select 'events can now recur on a weekday pattern through an end date' as done;
