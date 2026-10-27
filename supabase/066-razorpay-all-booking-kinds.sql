-- Extend the Razorpay payment requirement from 'activity' to every kind that
-- actually charges online, and add the same receipt fields to cab bookings
-- (2026-09-07).
--
-- 063 only gated 'activity', deliberately, to prove the gateway end to end
-- on one category first. Now that it works, this closes the same loophole
-- for ferry, event, trip and rental: create_booking demands a verified
-- payment id whenever the computed price is more than zero, regardless of
-- kind. 'table' is untouched — its price is hardcoded 0 in create_booking's
-- own select, so the new check never fires for it.
--
-- Cabs are a separate function (create_cab_booking, 049) with their own
-- pay_mode ('none' — pay the driver, or 'full' — pay online), so it gets the
-- same two receipt columns and the same idempotency shortcut, gated on
-- p_pay_mode = 'full' rather than price > 0 (a cab fare is never zero, but
-- "pay the driver" is a legitimate ₹0-online choice, same as it is today).

create or replace function create_booking(
  p_kind text,
  p_subject text,
  p_starts_at timestamp with time zone,
  p_party integer default 1,
  p_units integer default 1,
  p_variant text default null,
  p_extras boolean default false,
  p_pay_mode text default 'full',
  p_razorpay_order_id text default null,
  p_razorpay_payment_id text default null
) returns table (
  ref_code text, ticket_code text, price_paise integer,
  state text, paid_online_paise integer, balance_paise integer
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
  v_kind_seq   int;
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

  -- A retry of a request that already paid: hand back the booking that
  -- payment made instead of raising (the seat is already taken) or, worse,
  -- taking a second seat for the same charge.
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

    else
      raise exception 'unknown booking kind "%"', p_kind using errcode = '22023';
  end case;

  if v_subject_id is null then
    raise exception 'nothing bookable found for % "%"', p_kind, p_subject using errcode = '22023';
  end if;

  -- Any kind with a real price now needs a verified payment. 'table' always
  -- prices at 0 above, so this never fires for it — no other kind reaching
  -- this line does that.
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

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = p_kind;

  v_ticket := v_ref || '-' || upper(left(p_kind, 1))
            || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, variant_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at, razorpay_order_id, razorpay_payment_id)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     p_party, p_units, v_price, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id);

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;

revoke all on function create_booking(
  text, text, timestamp with time zone, integer, integer, text, boolean, text, text, text
) from public;
grant execute on function create_booking(
  text, text, timestamp with time zone, integer, integer, text, boolean, text, text, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_cab_booking: same two receipt columns, required only when the
-- traveller chose to pay online now (p_pay_mode = 'full') — "the driver
-- calls, pay on arrival" stays a legitimate ₹0-online booking.
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
  p_pay_mode     text default 'none',
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
  if p_pay_mode not in ('none','full') then
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

  if p_pay_mode = 'full' and p_razorpay_payment_id is null then
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

  -- Payment split.
  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := 0; v_balance := v_fare;
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

-- The 10-arg signature is being replaced, not overloaded.
drop function if exists create_cab_booking(
  text, text, text, uuid, uuid, timestamptz, date, int, text, text
);

select 'razorpay wired for ferry, event, trip, rental and cab bookings' as done;
