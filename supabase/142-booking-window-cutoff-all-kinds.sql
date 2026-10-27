-- ===========================================================================
-- Migration 142 — the 2-hour close applies to every timed category
--
-- 141 closed ferry and event bookings 2 hours before they start. The app's
-- read paths now do the same dynamic close-and-hide for activities, trips
-- and rentals too (lib/activities.ts, lib/trips.ts, lib/rentals.ts) — an
-- activity slot later today is offered right up until 2 hours out instead of
-- the whole day being blanked just because it's "today", and same-day rental
-- pick-up and same-day trip departures work the same way. This migration is
-- the matching server-side enforcement, so calling create_booking directly
-- can't skip it either.
--
-- cab and stays are untouched — neither goes through create_booking at all
-- (they have their own booking RPCs), so listing every kind this function
-- actually handles is already "every category except cab and stays".
--
-- Safe to run more than once.
-- ===========================================================================

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
  p_razorpay_payment_id text default null
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
  v_capacity   int;
  v_taken      int;
  v_needed     int := p_party;
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

  -- Every timed category this function handles closes 2 hours before it
  -- starts — checked up front, before even looking the subject up, same as
  -- the "not signed in" / range checks above, so a stale page can't slip
  -- past it another way. cab and stays never call create_booking at all, so
  -- this list is already "every kind except those two".
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

  -- Every kind reaching this line now has a real price, so a verified
  -- payment is always required (the free 'table' branch that used to be the
  -- one exception is gone).
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

  -- The online amount for 'deposit' is exactly this business's own agreed
  -- commission (137) — not a flat platform rate. Every subject above
  -- resolves v_partner_id, so this always has a specific partner to read.
  select commission_bps into v_bps from partners where id = v_partner_id;
  v_deposit := round(v_price * coalesce(v_bps, 3000) / 10000.0)::int;
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

select 'create_booking: 2-hour close now applies to every timed category (all but cab and stays)' as done;
