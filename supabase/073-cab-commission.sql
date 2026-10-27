-- ===========================================================================
-- Migration 073 — a 15% commission on cab bookings, collected online
--
-- Cabs launched (048/049) commission-free: commission_rates('cab') = 0, and
-- the traveller could book at ₹0 ("the driver calls you", pay_mode 'none') or
-- pay the whole fare online (pay_mode 'full'). The business now takes a
-- commission on cab bookings like every other category, and checkout must
-- collect at least that commission online — the rest of the fare is paid
-- straight to the driver.
--
-- What changes here:
--   * commission_rates('cab')      0  -> 1500 bps (15%), admin-editable as before
--   * commission_rates readable by anon — the cabs catalogue reads through the
--     anon client, and the rate is not secret (025 comment). The RLS policy is
--     already `using (true)`; this only adds the GRANT.
--   * booking_items.pay_mode gains 'partial' — "part-paid online, the balance
--     owed to the driver". Distinct from 'deposit' (a hard-wired 30%, and its
--     copy says "30% deposit"). Cabs now use 'full' or 'partial'; 'none' is
--     retired for cabs (all existing rows are pre-launch test data).
--   * create_cab_booking — p_pay_mode in ('full','partial'); the online amount
--     for 'partial' is exactly the commission (round(fare * bps / 10000)); a
--     verified Razorpay payment is now required for *every* cab booking.
--   * cancel_my_booking_item — the online money on a 'partial' booking is not
--     refundable, same as a 'deposit'.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The rate card: cabs are 15%.
-- ---------------------------------------------------------------------------

insert into commission_rates (kind, bps, updated_at) values ('cab', 1500, now())
on conflict (kind) do update set bps = 1500, updated_at = now();

-- The cabs catalogue (lib/cabs.ts) reads through the anon client to show the
-- split at checkout. The rate is not secret — a partner and the earnings views
-- already read it — and the policy is `for select using (true)` (025).
grant select on commission_rates to anon;


-- ---------------------------------------------------------------------------
-- 2. booking_items.pay_mode gains 'partial'.
-- ---------------------------------------------------------------------------

alter table booking_items drop constraint if exists booking_items_pay_mode_check;
alter table booking_items add constraint booking_items_pay_mode_check
  check (pay_mode in ('full', 'deposit', 'none', 'partial'));


-- ---------------------------------------------------------------------------
-- 3. create_cab_booking — commission collected online, balance to the driver.
--    Body carried over from 066; the changes are the pay-mode set, the
--    commission split, and the "payment always required" guard.
-- ---------------------------------------------------------------------------

create or replace function create_cab_booking(
  p_operator     text,
  p_cab          text,
  p_trip_type    text,
  p_from         uuid,
  p_to           uuid,
  p_starts_at    timestamptz,
  p_return_date  date default null,
  p_days         int  default 1,
  p_pickup_note  text default '',
  p_pay_mode     text default 'partial',
  p_razorpay_order_id   text default null,
  p_razorpay_payment_id text default null
)
returns table (
  ref_code text, ticket_code text, fare_paise int,
  paid_online_paise int, balance_paise int
)
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_operator  uuid;
  v_cab_id    uuid;
  v_island    text;
  v_full_day  int;
  v_air_sur   int;
  v_night_sur int;
  v_base      int;
  v_fare      int;
  v_bps       int;
  v_commission int;
  v_days      int := greatest(coalesce(p_days, 1), 1);
  v_start_day date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_end_day   date;
  v_time_mins int := extract(hour from p_starts_at at time zone 'Asia/Kolkata') * 60
                   + extract(minute from p_starts_at at time zone 'Asia/Kolkata');
  v_is_airport boolean;
  v_night     boolean;
  v_clash     int;
  v_paid      int;
  v_balance   int;
  v_booking   uuid;
  v_ref       text;
  v_ticket    text;
  v_kind_seq  int;
  v_item      uuid;
  v_phone     text;
  v_email     text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_trip_type not in ('oneway','roundtrip','fullday') then
    raise exception 'unknown trip type "%"', p_trip_type using errcode = '22023';
  end if;
  if p_pay_mode not in ('full','partial') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;

  -- Same retry shortcut as create_booking: a repeat call carrying a payment
  -- id that already bought a booking returns that booking, not a new one.
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

  select p.id, c.id, p.island_slug, c.full_day_paise,
         c.airport_surcharge_paise, c.night_surcharge_paise
    into v_operator, v_cab_id, v_island, v_full_day, v_air_sur, v_night_sur
  from partners p
  join cabs c on c.partner_id = p.id and c.code = p_cab and c.is_listed
  where p.slug = p_operator and p.kind = 'cab' and p.status = 'approved';

  if v_cab_id is null then
    raise exception 'nothing bookable found for cab "%"', p_cab using errcode = '22023';
  end if;

  -- Every cab booking now collects money online (at least the commission), so
  -- a verified payment is always required.
  if p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

  -- Fare.
  if p_trip_type = 'fullday' then
    v_base := v_full_day * v_days;
    v_end_day := v_start_day + (v_days - 1);
  else
    if p_from is null or p_to is null or p_from = p_to then
      raise exception 'a pickup and a drop are required' using errcode = '22023';
    end if;

    select case when p_trip_type = 'roundtrip' then roundtrip_paise else oneway_paise end
      into v_base
    from cab_routes
    where cab_id = v_cab_id and from_place_id = p_from and to_place_id = p_to;

    if v_base is null or v_base <= 0 then
      raise exception 'no fare set for this route' using errcode = '22023';
    end if;

    if p_trip_type = 'roundtrip' then
      if p_return_date is null or p_return_date < v_start_day then
        raise exception 'the return date must be on or after the pickup date' using errcode = '22023';
      end if;
      v_end_day := p_return_date;
    else
      v_end_day := v_start_day;
    end if;
  end if;

  v_is_airport := p_trip_type <> 'fullday' and exists (
    select 1 from cab_places where id in (p_from, p_to) and is_airport
  );
  v_night := v_time_mins >= 22 * 60 or v_time_mins < 6 * 60;

  v_fare := v_base
          + case when v_is_airport then v_air_sur else 0 end
          + case when v_night then v_night_sur else 0 end;

  -- Is this car free across [v_start_day .. v_end_day]? One car = one unit.
  perform pg_advisory_xact_lock(hashtext('cab:' || v_cab_id::text));

  select count(*) into v_clash
  from booking_items bi
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.cab_id = v_cab_id
    and bi.state in ('pending','confirmed','disrupted','completed')
    and (bi.starts_at at time zone 'Asia/Kolkata')::date <= v_end_day
    and case d.trip_type
          when 'fullday'   then (bi.starts_at at time zone 'Asia/Kolkata')::date + (d.days - 1)
          when 'roundtrip' then coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date)
          else (bi.starts_at at time zone 'Asia/Kolkata')::date
        end >= v_start_day;

  if v_clash > 0 then
    raise exception 'this car is booked for those dates' using errcode = '23514';
  end if;

  -- Payment split. The online amount for 'partial' is exactly Andaman Go's
  -- commission, read from the same rate card the admin edits; the rest of the
  -- fare is settled with the driver.
  select bps into v_bps from commission_rates where kind = 'cab';
  v_bps := coalesce(v_bps, 1500);
  v_commission := round(v_fare * v_bps / 10000.0)::int;

  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := v_commission; v_balance := v_fare - v_commission;
  end if;

  -- One reference per traveller per day, same as create_booking.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, v_island, v_start_day, v_phone, v_email)
    returning id into v_booking;
  end if;

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = 'cab';

  v_ticket := v_ref || '-C' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, cab_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at, razorpay_order_id, razorpay_payment_id)
  values
    (v_booking, 'cab', v_operator, v_cab_id, v_operator, p_starts_at,
     1, case when p_trip_type = 'fullday' then v_days else 1 end,
     v_fare, p_pay_mode, v_paid, v_balance,
     'confirmed', v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id)
  returning id into v_item;

  insert into cab_trip_details
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note)
  values
    (v_item, p_trip_type,
     case when p_trip_type = 'fullday' then null else p_from end,
     case when p_trip_type = 'fullday' then null else p_to end,
     case when p_trip_type = 'roundtrip' then p_return_date else null end,
     v_days, coalesce(trim(p_pickup_note), ''));

  return query select v_ref, v_ticket, v_fare, v_paid, v_balance;
end $$;

revoke all on function create_cab_booking(
  text, text, text, uuid, uuid, timestamptz, date, int, text, text, text, text
) from public;
grant execute on function create_cab_booking(
  text, text, text, uuid, uuid, timestamptz, date, int, text, text, text, text
) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 4. cancel_my_booking_item — the money paid online on a 'partial' booking is
--    not refundable, exactly like a 'deposit'. Body carried over from 067
--    (the 4-column return shape that drives the real Razorpay refund).
-- ---------------------------------------------------------------------------

create or replace function cancel_my_booking_item(p_item_id uuid)
returns table (ok boolean, message text, razorpay_payment_id text, refund_paise integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_state      text;
  v_starts     timestamptz;
  v_partner    uuid;
  v_kind       text;
  v_subject    uuid;
  v_mode       text;
  v_price      int;
  v_paid       int;
  v_refund     int;
  v_title      text;
  v_razorpay_p text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.state, i.starts_at, i.partner_id, i.kind, i.subject_id,
         i.pay_mode, i.price_paise, i.paid_online_paise, i.razorpay_payment_id
    into v_state, v_starts, v_partner, v_kind, v_subject,
         v_mode, v_price, v_paid, v_razorpay_p
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text, null::text, null::int;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be cancelled here.'::text, null::text, null::int;
    return;
  end if;

  -- The rule. A deposit and a cab's part-payment are both money paid to hold
  -- the booking — neither comes back.
  if v_mode in ('deposit', 'partial') then
    v_refund := 0;
  elsif now() <= v_starts - interval '24 hours' then
    v_refund := round(v_price * 0.5)::int;
  else
    v_refund := 0;
  end if;

  -- Never hand back more than came in.
  v_refund := least(v_refund, v_paid);

  update booking_items
  set state = 'refunded', refunded_paise = v_refund, cancelled_at = now()
  where id = p_item_id;

  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'Booking cancelled by the traveller',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, (case
    when v_refund > 0 then 'Cancelled. Half comes back to you.'
    when v_mode = 'deposit' then 'Cancelled. The deposit is not refundable.'
    when v_mode = 'partial' then 'Cancelled. The amount paid online is not refundable.'
    else 'Cancelled. Inside 24 hours, nothing is refunded.'
  end)::text,
  (case when v_refund > 0 then v_razorpay_p else null end),
  v_refund;
end $$;

revoke all on function cancel_my_booking_item(uuid) from public;
grant execute on function cancel_my_booking_item(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Checks.
-- ---------------------------------------------------------------------------

select 'cab commission' as done,
  (select bps from commission_rates where kind = 'cab') as cab_bps;
