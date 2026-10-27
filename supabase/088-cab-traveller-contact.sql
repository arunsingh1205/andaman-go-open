-- ===========================================================================
-- Migration 088 — a name and a working phone number, captured up front
--
-- Every other booking kind can get away with prompting for a phone number
-- after the fact (PhonePrompt, on /booked) — nobody's coming to get you
-- today. A cab is different: dispatch needs to ring someone before the
-- trip, and "Not given" on a same-day pickup is a real problem, not a
-- cosmetic gap. So the rate-card flow now collects the traveller's name and
-- phone as part of checkout, not afterwards, and both are always written
-- straight onto the booking — never left to whatever (if anything) sat in
-- traveller_profiles beforehand.
--
-- bookings.contact_name is new (bookings.contact_phone/contact_email have
-- existed since 007/008); admin_bookings and partner_bookings both grow it
-- so admin and whichever operator gets the job both see who they're
-- calling, not just a number. Every other booking kind is untouched — this
-- only ever gets filled in by the cab flow.
--
-- Safe to run more than once.
-- ===========================================================================

alter table bookings add column if not exists contact_name text;


-- ---------------------------------------------------------------------------
-- 1. create_ratecard_cab_booking — name and phone are now required
--    parameters, always written onto the bookings row (new or reused for
--    the day), not sourced from traveller_profiles. Body otherwise carried
--    over from 081.
-- ---------------------------------------------------------------------------

create or replace function create_ratecard_cab_booking(
  p_island_slug      text,
  p_from_place_id    uuid,
  p_to_place_id      uuid,
  p_trip_type        text,
  p_vehicle_category text,
  p_starts_at        timestamptz,
  p_traveller_name    text,
  p_traveller_phone   text,
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
  v_name       text := nullif(trim(p_traveller_name), '');
  v_phone      text := regexp_replace(coalesce(p_traveller_phone, ''), '[^0-9+]', '', 'g');
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
  if v_name is null then
    raise exception 'a name is required for this booking' using errcode = '22023';
  end if;

  -- Same cleaning as set_my_phone (007): a bare Indian mobile gets +91.
  if v_phone ~ '^[6-9][0-9]{9}$' then
    v_phone := '+91' || v_phone;
  elsif v_phone ~ '^91[6-9][0-9]{9}$' then
    v_phone := '+' || v_phone;
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a phone number' using errcode = '22023';
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

  select id into v_booking
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select email into v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_name, contact_phone, contact_email)
    values (v_ref, v_user, p_island_slug, v_start_day, v_name, v_phone, v_email)
    returning id into v_booking;
  else
    -- The traveller is telling us right now, at checkout, who to call for
    -- this trip — that always wins over whatever (if anything) was on the
    -- reference already.
    update bookings set contact_name = v_name, contact_phone = v_phone
    where id = v_booking
    returning ref_code into v_ref;
  end if;

  -- Worth remembering for next time, but never overwrite a number the
  -- traveller already has saved.
  update traveller_profiles set phone = coalesce(phone, v_phone) where user_id = v_user;

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
  text, uuid, uuid, text, text, timestamptz, text, text, text, text, text, text, numeric, numeric
) from public;
grant execute on function create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text, text, text, numeric, numeric
) to authenticated, anon;

-- 081's 12-arg version is superseded by the 14-arg one above.
drop function if exists create_ratecard_cab_booking(
  text, uuid, uuid, text, text, timestamptz, text, text, text, text, numeric, numeric
);


-- ---------------------------------------------------------------------------
-- 2. admin_bookings and partner_bookings grow contact_name. Bodies carried
--    over from 079 and 034 respectively, with that one column added.
-- ---------------------------------------------------------------------------

create or replace view admin_bookings as
select
  i.id            as item_id,
  b.id            as booking_id,
  b.ref_code,
  i.partner_id,
  p.name          as partner_name,
  p.status        as partner_status,
  b.island_slug,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  i.cancelled_note,
  b.contact_name,
  b.contact_phone,
  b.contact_email,
  b.created_at    as booked_at,
  cr.bps          as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.cancelled_at,
  i.delivery_paise,
  i.refund_status,
  i.cab_id,
  i.driver_id
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


create or replace view partner_bookings as
select
  i.id as item_id,
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  b.contact_name,
  b.contact_phone,
  b.contact_email,
  i.cancelled_note,
  i.confirmed_at,
  b.created_at as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'traveller' and m.read_at is null
  ) as unread_from_traveller,
  i.subject_id,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);
revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;


select 'cab traveller contact ready' as done;
