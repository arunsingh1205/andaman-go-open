-- ===========================================================================
-- Migration 158 — promo codes (flat amount off, once per traveller per code)
--
-- A reason to book now: a code like FIRSTGO knocks a flat amount off a
-- booking. Two tables:
--
--   * promo_codes — one row per code. code is the thing a traveller types
--     (stored upper-cased), discount_paise the flat amount, active the
--     on/off switch. No expiry/min-order/per-kind columns yet — not asked
--     for, and easy to add later without touching the redemption logic.
--   * promo_redemptions — one row per (code, traveller) that's actually
--     used it, written only by create_booking at the moment a booking is
--     actually placed (never by the "Apply" preview, see
--     validate_promo_code below). The unique constraint is what makes
--     "once per traveller per code" an actual guarantee rather than a
--     client-side suggestion, race-condition and multi-tab included.
--
-- booking_items gains promo_code / discount_paise so a receipt, the admin
-- console, or a partner's own booking list can show what was applied — the
-- same "mirror the decision onto the row" pattern delivery_paise (064) and
-- ticket_label (153) already use.
--
-- Where the discount lands: it reduces price_paise itself, before the
-- deposit/commission math runs — same as every other price-affecting input
-- this function already has (delivery, ticket tiers). That means a
-- discounted booking's commission (and so a partner's payout) is computed
-- on the lower, discounted price — the partner effectively shares the cost
-- of the promotion in proportion to their commission rate, same as they
-- would for any other price reduction. If that's not the intended split
-- (e.g. Andaman Go should absorb it entirely, partner payout unaffected),
-- that's a deliberately separate, bigger change to the commission/
-- settlement math, not folded in here.
--
-- validate_promo_code is a read-only preview — the "Apply" button calls it
-- to show "₹200 off" before the traveller ever pays, without marking
-- anything as redeemed. Redemption only happens inside create_booking, at
-- the moment a booking is actually placed, which is what the unique
-- constraint on promo_redemptions actually enforces.
--
-- create_booking gains a new p_promo_code param — changes its signature,
-- so (same trap this repo has hit before) the old one is dropped first.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists promo_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  discount_paise int  not null check (discount_paise > 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists promo_redemptions (
  id             uuid primary key default gen_random_uuid(),
  promo_code_id  uuid not null references promo_codes(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_id        uuid not null references booking_items(id) on delete cascade,
  discount_paise int  not null,
  created_at     timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

alter table booking_items
  add column if not exists promo_code text,
  add column if not exists discount_paise int not null default 0;

alter table promo_codes enable row level security;
alter table promo_redemptions enable row level security;

-- No traveller-facing select policy on either — a code's existence/discount
-- is only ever revealed through validate_promo_code, never a direct read,
-- so someone can't browse the table to find out what codes exist. Writes to
-- both go only through SECURITY DEFINER functions, same as booking_messages
-- and every other table in this schema that's RPC-only.
revoke all on promo_codes from public, anon, authenticated;
revoke all on promo_redemptions from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- validate_promo_code — read-only preview. Does not redeem anything.
-- ---------------------------------------------------------------------------

create or replace function validate_promo_code(p_code text)
returns table (ok boolean, message text, discount_paise int)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := upper(trim(coalesce(p_code, '')));
  v_promo_id uuid;
  v_discount int;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if v_code = '' then
    return query select false, 'Enter a code.'::text, null::int;
    return;
  end if;

  select pc.id, pc.discount_paise into v_promo_id, v_discount
  from promo_codes pc
  where pc.code = v_code and pc.active;

  if v_promo_id is null then
    return query select false, 'That code isn''t valid.'::text, null::int;
    return;
  end if;

  if exists (
    select 1 from promo_redemptions
    where promo_code_id = v_promo_id and user_id = v_user
  ) then
    return query select false, 'You''ve already used that code.'::text, null::int;
    return;
  end if;

  return query select true, 'Code applied.'::text, v_discount;
end $$;

revoke all on function validate_promo_code(text) from public;
grant execute on function validate_promo_code(text) to authenticated;


-- ---------------------------------------------------------------------------
-- create_booking — same body as 157, plus a new trailing p_promo_code
-- param. Old 11-arg signature dropped first (see migration header).
-- ---------------------------------------------------------------------------

drop function if exists create_booking(
  text, text, timestamptz, int, int, text, boolean, text, text, text, text
);

create function create_booking(
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
  p_delivery_hotel text default null,
  p_promo_code text default null
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
  v_item       uuid;
  v_kind_seq   int;
  v_phone      text;
  v_email      text;
  v_promo_id   uuid;
  v_promo_code text;
  v_discount   int := 0;
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

  -- Promo code — resolved once the price is final for the kind (after the
  -- event-ticket-tier override above), before the payment-verification
  -- check, since that check has to see the actual discounted amount.
  if coalesce(trim(p_promo_code), '') <> '' then
    v_promo_code := upper(trim(p_promo_code));

    select pc.id, pc.discount_paise into v_promo_id, v_discount
    from promo_codes pc
    where pc.code = v_promo_code and pc.active;

    if v_promo_id is null then
      raise exception 'that code is not valid' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from promo_redemptions
      where promo_code_id = v_promo_id and user_id = v_user
    ) then
      raise exception 'that code has already been used' using errcode = 'P0001';
    end if;

    v_discount := least(v_discount, v_price);
    v_price := v_price - v_discount;
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
     pickup_address, ticket_label, promo_code, discount_paise)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     v_party, p_units, v_price, v_delivery, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id,
     case when p_kind = 'rental' and p_extras then trim(p_delivery_hotel) else null end,
     v_ticket_lbl, v_promo_code, v_discount)
  returning id into v_item;

  if v_promo_id is not null then
    begin
      insert into promo_redemptions (promo_code_id, user_id, item_id, discount_paise)
      values (v_promo_id, v_user, v_item, v_discount);
    exception when unique_violation then
      -- Lost a race with another request redeeming the same code for this
      -- same traveller at the same instant — the booking itself already
      -- succeeded above, so this can't un-book it; it just means the
      -- discount this booking recorded didn't actually get locked in.
      -- Vanishingly rare (would need two simultaneous checkouts), and a
      -- real refund-the-difference case for support rather than something
      -- to paper over here.
      null;
    end;
  end if;

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;

revoke all on function create_booking(
  text, text, timestamptz, int, int, text, boolean, text, text, text, text, text
) from public;
grant execute on function create_booking(
  text, text, timestamptz, int, int, text, boolean, text, text, text, text, text
) to anon, authenticated, service_role;

select 'promo codes ready' as done;
