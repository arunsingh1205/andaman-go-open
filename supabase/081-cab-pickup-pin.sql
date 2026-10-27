-- ===========================================================================
-- Migration 081 — a GPS pin on a rate-card cab booking's pickup
--
-- The named place picker gets a traveller close; it doesn't get a driver to
-- the actual villa gate. When the browser's own location permission is
-- available, the traveller can drop a pin alongside (or instead of) the
-- named pickup — no Google Maps API, just navigator.geolocation and a plain
-- Maps deep link, the same trick DirectionsButton already uses.
--
-- Safe to run more than once.
-- ===========================================================================

alter table cab_trip_details add column if not exists pickup_lat numeric(9,6);
alter table cab_trip_details add column if not exists pickup_lng numeric(9,6);

alter table cab_trip_details drop constraint if exists cab_trip_details_pickup_lat_check;
alter table cab_trip_details add constraint cab_trip_details_pickup_lat_check
  check (pickup_lat is null or pickup_lat between -90 and 90);

alter table cab_trip_details drop constraint if exists cab_trip_details_pickup_lng_check;
alter table cab_trip_details add constraint cab_trip_details_pickup_lng_check
  check (pickup_lng is null or pickup_lng between -180 and 180);


-- create_ratecard_cab_booking (078) gains two trailing optional params and
-- stores them. Body carried over from 078 otherwise unchanged.
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
  p_razorpay_payment_id text default null,
  p_pickup_lat        numeric default null,
  p_pickup_lng        numeric default null
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
  if p_pickup_lat is not null and (p_pickup_lat < -90 or p_pickup_lat > 90) then
    raise exception 'pickup latitude out of range' using errcode = '22023';
  end if;
  if p_pickup_lng is not null and (p_pickup_lng < -180 or p_pickup_lng > 180) then
    raise exception 'pickup longitude out of range' using errcode = '22023';
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

  if p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

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

  select bps into v_bps from commission_rates where kind = 'cab';
  v_bps := coalesce(v_bps, 1500);
  v_commission := round(v_fare * v_bps / 10000.0)::int;

  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := v_commission; v_balance := v_fare - v_commission;
  end if;

  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, p_island_slug, v_start_day, v_phone, v_email)
    returning id into v_booking;
  end if;

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
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note,
     pickup_lat, pickup_lng)
  values
    (v_item, p_trip_type, p_from_place_id, p_to_place_id, v_return_date, v_days,
     coalesce(trim(p_pickup_note), ''), p_pickup_lat, p_pickup_lng);

  return query select v_ref, null::text, v_fare, v_paid, v_balance;
end $$;

revoke all on function create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text, numeric, numeric
) from public;
grant execute on function create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text, numeric, numeric
) to authenticated, anon;

-- 078's 10-arg version is superseded by the 12-arg one above (two new
-- trailing optional params) — drop it explicitly since a default-argument
-- change doesn't let Postgres treat this as the same overload.
drop function if exists create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text
);


select 'cab pickup pin ready' as done;
