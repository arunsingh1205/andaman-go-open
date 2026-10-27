-- ===========================================================================
-- Migration 078 — Cab rate card + manual driver dispatch, functions
--
--   * create_ratecard_cab_booking — a traveller books and pays against the
--     standardized rate card (077), not against a specific car. No car/driver
--     is locked at booking time; the fare is whatever cab_rate_card says.
--     ticket_code stays null and state stays 'pending' until dispatched —
--     the same shape an unplaced ferry booking already has (039).
--   * admin_assign_cab_driver — the one write dispatch makes: pick a driver,
--     re-check that driver's own overlap window, confirm the booking and
--     issue its ticket. Callable again to reassign, so "try someone else" is
--     just calling it again with a different driver id.
--   * admin_upsert_cab_driver / admin_set_driver_active — admin-only CRUD for
--     the roster.
--   * admin_upsert_cab_rate / admin_set_cab_rate_active — admin-only CRUD for
--     the rate card itself (this is Andaman Go's own price list, not a
--     partner's, so it gets an admin screen the way partner fares don't).
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. create_ratecard_cab_booking.
--
--    trip_type 'roundtrip' is always same-day (the sightseeing/transfer rows
--    on the rate card are there-and-back trips within a day); 'outstation'
--    is a fixed-length package — its night count comes from the matched rate
--    row, not from the traveller, since a package's length isn't negotiable.
--    No airport/night surcharge: a standardized fare has no per-car add-ons,
--    that's the point of it.
-- ---------------------------------------------------------------------------

create or replace function create_ratecard_cab_booking(
  p_island_slug      text,
  p_from_place_id    uuid,
  p_to_place_id      uuid,
  p_trip_type        text,
  p_vehicle_category text,
  p_starts_at        timestamptz,
  p_pickup_note      text default '',
  p_pay_mode         text default 'partial',
  p_razorpay_order_id   text default null,
  p_razorpay_payment_id text default null
)
returns table (
  ref_code text, ticket_code text, fare_paise int,
  paid_online_paise int, balance_paise int
)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_operator   uuid;
  v_fare       int;
  v_nights     int;
  v_bps        int;
  v_commission int;
  v_paid       int;
  v_balance    int;
  v_start_day  date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_end_day    date;
  v_return_date date;
  v_days       int;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
  v_item       uuid;
  v_phone      text;
  v_email      text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_trip_type not in ('oneway','roundtrip','outstation') then
    raise exception 'unknown trip type "%"', p_trip_type using errcode = '22023';
  end if;
  if p_vehicle_category not in ('hatchback','sedan','suv','tempo') then
    raise exception 'unknown vehicle category "%"', p_vehicle_category using errcode = '22023';
  end if;
  if p_pay_mode not in ('full','partial') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;

  -- Same retry shortcut as create_cab_booking: a repeat call carrying a
  -- payment id that already bought a booking returns that booking.
  if p_razorpay_payment_id is not null then
    select b.ref_code, bi.ticket_code, bi.price_paise,
           bi.paid_online_paise, bi.balance_paise
      into v_ref, v_ticket, v_fare, v_paid, v_balance
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where bi.razorpay_payment_id = p_razorpay_payment_id;

    if found then
      return query select v_ref, v_ticket, v_fare, v_paid, v_balance;
      return;
    end if;
  end if;

  select id into v_operator from partners where slug = 'andaman-go-cabs';
  if v_operator is null then
    raise exception 'the cab dispatch desk is not set up yet' using errcode = '22023';
  end if;

  -- Every cab booking collects money online (073), so a verified payment is
  -- always required.
  if p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

  -- Fare: an exact (from, to) match first, else the "any pickup in the
  -- standard zone" wildcard row for the same destination.
  select fare_paise, nights into v_fare, v_nights
  from cab_rate_card
  where island_slug = p_island_slug
    and trip_type = p_trip_type
    and vehicle_category = p_vehicle_category
    and is_active
    and from_place_id is not distinct from p_from_place_id
    and to_place_id is not distinct from p_to_place_id;

  if v_fare is null and p_from_place_id is not null then
    select fare_paise, nights into v_fare, v_nights
    from cab_rate_card
    where island_slug = p_island_slug
      and trip_type = p_trip_type
      and vehicle_category = p_vehicle_category
      and is_active
      and from_place_id is null
      and to_place_id is not distinct from p_to_place_id;
  end if;

  if v_fare is null or v_fare <= 0 then
    raise exception 'no fare set for this trip' using errcode = '22023';
  end if;

  if p_trip_type = 'outstation' then
    v_days := greatest(coalesce(v_nights, 0) + 1, 1);
    v_end_day := v_start_day + (v_days - 1);
    v_return_date := v_end_day;
  else
    v_days := 1;
    v_end_day := v_start_day;
    v_return_date := null;
  end if;

  -- Payment split — the same commission rate and shape as the marketplace
  -- flow (073): the online amount for 'partial' is exactly the commission.
  select bps into v_bps from commission_rates where kind = 'cab';
  v_bps := coalesce(v_bps, 1500);
  v_commission := round(v_fare * v_bps / 10000.0)::int;

  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := v_commission; v_balance := v_fare - v_commission;
  end if;

  -- One reference per traveller per day, same as create_booking /
  -- create_cab_booking.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, p_island_slug, v_start_day, v_phone, v_email)
    returning id into v_booking;
  end if;

  -- ticket_code stays null: no car or driver is attached yet. It's issued by
  -- admin_assign_cab_driver once dispatch actually finds one.
  insert into booking_items
    (booking_id, kind, subject_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, razorpay_order_id, razorpay_payment_id)
  values
    (v_booking, 'cab', v_operator, v_operator, p_starts_at,
     1, 1, v_fare, p_pay_mode, v_paid, v_balance,
     'pending', p_razorpay_order_id, p_razorpay_payment_id)
  returning id into v_item;

  insert into cab_trip_details
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note)
  values
    (v_item, p_trip_type, p_from_place_id, p_to_place_id, v_return_date, v_days,
     coalesce(trim(p_pickup_note), ''));

  return query select v_ref, null::text, v_fare, v_paid, v_balance;
end $$;

revoke all on function create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text
) from public;
grant execute on function create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text
) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 2. admin_assign_cab_driver — the one write dispatch makes.
-- ---------------------------------------------------------------------------

create or replace function admin_assign_cab_driver(p_item_id uuid, p_driver_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_kind        text;
  v_cab_id      uuid;
  v_state       text;
  v_starts      timestamptz;
  v_booking     uuid;
  v_ticket      text;
  v_ref         text;
  v_driver_active boolean;
  v_trip_type   text;
  v_return_date date;
  v_days        int;
  v_start_day   date;
  v_end_day     date;
  v_clash       int;
  v_kind_seq    int;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select i.kind, i.cab_id, i.state, i.starts_at, i.booking_id, i.ticket_code
    into v_kind, v_cab_id, v_state, v_starts, v_booking, v_ticket
  from booking_items i where i.id = p_item_id
  for update of i;

  if v_kind is null then
    return query select false, 'That booking no longer exists.'::text;
    return;
  end if;
  if v_kind <> 'cab' or v_cab_id is not null then
    return query select false, 'That is not a rate-card cab booking.'::text;
    return;
  end if;
  if v_state = 'refunded' then
    return query select false, 'This booking was cancelled.'::text;
    return;
  end if;

  select is_active into v_driver_active from cab_drivers where id = p_driver_id;
  if v_driver_active is null then
    return query select false, 'That driver no longer exists.'::text;
    return;
  end if;
  if not v_driver_active then
    return query select false, 'That driver is marked inactive.'::text;
    return;
  end if;

  select d.trip_type, d.return_date, d.days into v_trip_type, v_return_date, v_days
  from cab_trip_details d where d.item_id = p_item_id;

  v_start_day := (v_starts at time zone 'Asia/Kolkata')::date;
  v_end_day := coalesce(v_return_date, v_start_day + greatest(coalesce(v_days, 1) - 1, 0));

  -- Is this driver free across [v_start_day .. v_end_day]? The real check is
  -- the phone call; this is the same belt-and-suspenders re-check every
  -- other cab booking in this codebase already does.
  perform pg_advisory_xact_lock(hashtext('cab-driver:' || p_driver_id::text));

  select count(*) into v_clash
  from booking_items bi
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.driver_id = p_driver_id
    and bi.id <> p_item_id
    and bi.state in ('pending','confirmed','disrupted','completed')
    and (bi.starts_at at time zone 'Asia/Kolkata')::date <= v_end_day
    and coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date + greatest(coalesce(d.days, 1) - 1, 0)) >= v_start_day;

  if v_clash > 0 then
    return query select false, 'This driver already has a trip over those dates — try someone else.'::text;
    return;
  end if;

  if v_ticket is null then
    select bookings.ref_code into v_ref from bookings where id = v_booking;
    select count(*) into v_kind_seq
    from booking_items where booking_id = v_booking and kind = 'cab' and created_at < (select created_at from booking_items where id = p_item_id);
    v_ticket := v_ref || '-C' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;
  end if;

  update booking_items
  set driver_id = p_driver_id,
      state = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      ticket_code = v_ticket
  where id = p_item_id;

  return query select true, 'Driver assigned. The traveller now sees their name and number.'::text;
end $$;

revoke all on function admin_assign_cab_driver(uuid, uuid) from public;
grant execute on function admin_assign_cab_driver(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_upsert_cab_driver / admin_set_driver_active — the roster CRUD.
-- ---------------------------------------------------------------------------

create or replace function admin_upsert_cab_driver(
  p_id               uuid,
  p_name             text,
  p_phone            text,
  p_vehicle_category text,
  p_island_slug      text,
  p_vehicle_model    text default '',
  p_vehicle_number   text default '',
  p_notes            text default '',
  p_is_active        boolean default true
)
returns table (ok boolean, message text, driver_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the driver a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_phone), '') = '' then
    return query select false, 'Give the driver a phone number.'::text, null::uuid;
    return;
  end if;
  if p_vehicle_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid vehicle type.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;

  if p_id is not null then
    update cab_drivers set
      name = trim(p_name),
      phone = trim(p_phone),
      vehicle_category = p_vehicle_category,
      vehicle_model = coalesce(trim(p_vehicle_model), ''),
      vehicle_number = coalesce(trim(p_vehicle_number), ''),
      island_slug = p_island_slug,
      notes = coalesce(trim(p_notes), ''),
      is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return query select false, 'That driver no longer exists.'::text, null::uuid;
      return;
    end if;
  else
    insert into cab_drivers
      (name, phone, vehicle_category, vehicle_model, vehicle_number, island_slug, notes, is_active)
    values
      (trim(p_name), trim(p_phone), p_vehicle_category, coalesce(trim(p_vehicle_model), ''),
       coalesce(trim(p_vehicle_number), ''), p_island_slug, coalesce(trim(p_notes), ''),
       coalesce(p_is_active, true))
    returning id into v_id;
  end if;

  return query select true, 'Saved.'::text, v_id;
end $$;

revoke all on function admin_upsert_cab_driver(uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function admin_upsert_cab_driver(uuid, text, text, text, text, text, text, text, boolean) to authenticated;


create or replace function admin_set_driver_active(p_id uuid, p_active boolean)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update cab_drivers set is_active = coalesce(p_active, false) where id = p_id;
  v_hit := found;

  if not v_hit then
    return query select false, 'That driver no longer exists.'::text;
    return;
  end if;

  return query select true, (case when p_active then 'Driver reactivated.' else 'Driver paused.' end)::text;
end $$;

revoke all on function admin_set_driver_active(uuid, boolean) from public;
grant execute on function admin_set_driver_active(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_upsert_cab_rate / admin_set_cab_rate_active — the rate card CRUD.
--    This is Andaman Go's own price list, not a partner's, so it gets an
--    admin screen the way partner fares don't.
-- ---------------------------------------------------------------------------

create or replace function admin_upsert_cab_rate(
  p_id               uuid,
  p_island_slug      text,
  p_label            text,
  p_trip_type        text,
  p_to_place_id      uuid,
  p_fare_paise       int,
  p_from_place_id    uuid default null,
  p_vehicle_category text default 'suv',
  p_nights           int default 0,
  p_sort_order       int default 0,
  p_is_active        boolean default true
)
returns table (ok boolean, message text, rate_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_label), '') = '' then
    return query select false, 'Give this fare a label.'::text, null::uuid;
    return;
  end if;
  if p_trip_type not in ('oneway','roundtrip','outstation') then
    return query select false, 'Choose a valid trip type.'::text, null::uuid;
    return;
  end if;
  if p_vehicle_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid vehicle type.'::text, null::uuid;
    return;
  end if;
  if p_fare_paise is null or p_fare_paise <= 0 then
    return query select false, 'Enter a fare greater than zero.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;

  if p_id is not null then
    update cab_rate_card set
      island_slug = p_island_slug,
      label = trim(p_label),
      trip_type = p_trip_type,
      from_place_id = p_from_place_id,
      to_place_id = p_to_place_id,
      vehicle_category = p_vehicle_category,
      fare_paise = p_fare_paise,
      nights = greatest(coalesce(p_nights, 0), 0),
      sort_order = coalesce(p_sort_order, 0),
      is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return query select false, 'That fare no longer exists.'::text, null::uuid;
      return;
    end if;
  else
    insert into cab_rate_card
      (island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category,
       fare_paise, nights, sort_order, is_active)
    values
      (p_island_slug, trim(p_label), p_trip_type, p_from_place_id, p_to_place_id, p_vehicle_category,
       p_fare_paise, greatest(coalesce(p_nights, 0), 0), coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
  end if;

  return query select true, 'Saved.'::text, v_id;
end $$;

revoke all on function admin_upsert_cab_rate(uuid, text, text, text, uuid, int, uuid, text, int, int, boolean) from public;
grant execute on function admin_upsert_cab_rate(uuid, text, text, text, uuid, int, uuid, text, int, int, boolean) to authenticated;


create or replace function admin_set_cab_rate_active(p_id uuid, p_active boolean)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update cab_rate_card set is_active = coalesce(p_active, false) where id = p_id;
  v_hit := found;

  if not v_hit then
    return query select false, 'That fare no longer exists.'::text;
    return;
  end if;

  return query select true, (case when p_active then 'Fare reactivated.' else 'Fare paused.' end)::text;
end $$;

revoke all on function admin_set_cab_rate_active(uuid, boolean) from public;
grant execute on function admin_set_cab_rate_active(uuid, boolean) to authenticated;


select 'cab rate card RPCs ready' as done;
