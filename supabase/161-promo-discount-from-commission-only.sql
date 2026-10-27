-- ===========================================================================
-- Migration 161 — a promo discount comes out of Andaman Go's own
-- commission, never the operator's share
--
-- 158 subtracted the discount straight out of price_paise before the
-- deposit/commission math ran — which meant a 'deposit' booking's online
-- deposit AND its in-person balance both shrank, and a 'full' booking's
-- later settlement payout shrank too: the operator ended up sharing the
-- discount in proportion to their own commission rate, on every single
-- discounted booking. That's wrong — a promo code is Andaman Go's own
-- marketing spend, not something an operator agreed to fund.
--
-- The fix has two parts:
--
--   1. create_booking now forces full payment the moment a discount is
--      actually applied. A 'deposit' booking's balance is cash the
--      operator collects in person, entirely outside Andaman Go's
--      control — there is no way to shrink that leg without either
--      shorting the operator's cash-in-hand or quietly overcharging the
--      traveller online to make up for it. Forcing full payment sidesteps
--      that: the whole (discounted) price is collected online, under
--      Andaman Go's control, and the operator is paid out in full later
--      through settlement — see the next part. (The app only ever offers
--      a promo code on Activities/Trips, and only those two categories
--      ever present a deposit choice in the first place — see
--      app/activities/[slug]/booking-panel.tsx and
--      app/trips/[slug]/trip-book.tsx, updated alongside this migration
--      to hide the deposit option and charge in full the moment a code is
--      applied, so what the traveller is charged always matches what this
--      function expects.)
--
--   2. Settlement is where the operator's payout is actually decided for a
--      'full'-mode booking (run_settlement_impl), and where the admin
--      Revenue screen and a partner's own Earnings tab (lib/admin-revenue.ts,
--      lib/partner-delivered.ts) preview the same number. All three now
--      compute commission as "what commission would have been on the
--      original, pre-discount price, minus the discount itself" — floored
--      at zero, never negative. The original price is just
--      price_paise + discount_paise (price_paise is already net of the
--      discount; compute_promo_discount never lets discount_paise exceed
--      the order amount, so this is always safe to add back). Concretely,
--      for the example that prompted this: an ₹800 booking with a ₹200
--      code and a 25%-commission operator — commission would have been
--      ₹200; minus the ₹200 discount, Andaman Go keeps ₹0 of it, and the
--      operator is still paid their usual ₹600 (800 − the original ₹200
--      commission), exactly as if there had been no discount at all. A
--      code steeper than what a given booking's commission can absorb
--      (rare — most categories run a higher rate than a typical promo)
--      floors Andaman Go's own cut at zero rather than going negative;
--      only beyond that point does the gap start coming out of the
--      operator's payout too, since there is nowhere else for it to come
--      from without Andaman Go funding it from outside the booking.
--
-- admin_bookings and partner_delivered both grow a discount_paise column
-- (appended at the end — existing columns, and every other reader of
-- either view, are untouched) so the two TypeScript call sites can do this
-- same reconstruction.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. create_booking — same 12-arg signature as 158/160, so a body-only
--    CREATE OR REPLACE is safe. Only change: force full payment the moment
--    a discount actually applies.
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
  v_promo_min  int;
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

    select pc.id, pc.min_order_paise into v_promo_id, v_promo_min
    from promo_codes pc
    where pc.code = v_promo_code and pc.active;

    if v_promo_id is null then
      raise exception 'that code is not valid' using errcode = 'P0001';
    end if;

    if not promo_code_applies(v_promo_id, p_kind, p_subject) then
      raise exception 'that code does not apply to this booking' using errcode = 'P0001';
    end if;

    if v_price < coalesce(v_promo_min, 0) then
      raise exception 'that code needs a higher order amount' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from promo_redemptions
      where promo_code_id = v_promo_id and user_id = v_user
    ) then
      raise exception 'that code has already been used' using errcode = 'P0001';
    end if;

    v_discount := compute_promo_discount(v_promo_id, v_price);
    v_price := v_price - v_discount;

    -- The discount is Andaman Go's own commission shrinking (see
    -- run_settlement_impl below), never the operator's cash — and a
    -- 'deposit' booking's balance is cash the operator collects in
    -- person, outside Andaman Go's control, so there is no way to apply a
    -- discount there without either shorting that cash or quietly
    -- overcharging the traveller online. Forcing full payment sidesteps
    -- the whole problem: everything (already discounted) is collected
    -- online, and the operator is made whole later through settlement.
    if v_discount > 0 then
      p_pay_mode := 'full';
    end if;
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

-- Grants unchanged from 158/160 — same signature, so they already stand;
-- no revoke/grant needed for a body-only replace.


-- ---------------------------------------------------------------------------
-- 2. admin_bookings / partner_delivered — both grow discount_paise,
--    appended at the end so every other column stays exactly where it was.
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
  b.contact_phone,
  b.contact_email,
  b.created_at    as booked_at,
  p.commission_bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.cancelled_at,
  i.delivery_paise,
  i.refund_status,
  i.cab_id,
  i.driver_id,
  i.stay_room_type_id,
  i.units,
  b.contact_name,
  i.discount_paise
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


create or replace view partner_delivered as
select
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.party,
  i.price_paise,
  i.starts_at,
  i.redeemed_at,
  p2.commission_bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.delivery_paise,
  i.discount_paise
from booking_items i
join bookings b on b.id = i.booking_id
join partners p2 on p2.id = i.partner_id
where i.redeemed_at is not null
  and exists (
    select 1 from partner_users pu
    where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
  );

alter view partner_delivered set (security_invoker = on);
grant select on partner_delivered to authenticated;


-- ---------------------------------------------------------------------------
-- 3. run_settlement_impl — same 2-arg signature as 137, so a body-only
--    CREATE OR REPLACE is safe. Only the delivered branch of
--    commission_paise changes: the commission a discounted booking would
--    have earned, on its original (pre-discount) price, minus the
--    discount itself — floored at zero. price_paise + discount_paise
--    reconstructs the original price (compute_promo_discount, 160, never
--    lets discount_paise exceed the order amount, so this is always safe).
--    A non-discounted booking has discount_paise = 0, so this is exactly
--    the old formula for every booking this migration doesn't touch.
-- ---------------------------------------------------------------------------

create or replace function run_settlement_impl(p_period_start date, p_period_end date)
returns table (partner_id uuid, items_settled int, net_payable_paise int)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid settlement period' using errcode = '22023';
  end if;

  for v_partner in
    select distinct bi.partner_id
    from booking_items bi
    where bi.pay_mode in ('full', 'deposit')
      and not exists (select 1 from settlement_items si where si.booking_item_id = bi.id)
      and (
        (
          bi.redeemed_at is not null
          and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
        )
        or (
          bi.state = 'refunded' and bi.cancelled_at is not null
          and coalesce(bi.paid_online_paise, 0) > coalesce(bi.refunded_paise, 0)
          and (bi.cancelled_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
        )
      )
  loop
    declare
      v_batch uuid;
      v_gross int;
      v_commission int;
      v_cash int;
      v_net int;
      v_count int;
      v_pbps int;
    begin
      select commission_bps into v_pbps from partners where id = v_partner;

      insert into settlement_batches (partner_id, period_start, period_end)
      values (v_partner, p_period_start, p_period_end)
      on conflict (partner_id, period_start) do update set period_end = excluded.period_end
      returning id into v_batch;

      insert into settlement_items (
        batch_id, booking_item_id, kind, event, gross_paise,
        commission_bps, commission_paise, cash_collected_paise, net_payable_paise
      )
      select
        v_batch, elig.id, elig.kind, elig.event, elig.gross_paise,
        elig.bps, elig.commission_paise, elig.cash_paise,
        greatest(0, elig.gross_paise - elig.commission_paise - elig.cash_paise)
      from (
        select
          base.id, base.kind,
          case when base.is_delivered then 'delivered' else 'cancelled_retained' end as event,
          case when base.is_delivered then base.price_paise else base.retained end as gross_paise,
          base.bps,
          -- Delivered: ordinarily this partner's own rate applied to the
          -- (non-delivery) price. When a promo code took money off this
          -- booking (discount_paise > 0), that discount comes out of this
          -- number instead of the price itself — Andaman Go's own cut
          -- shrinks by the discount, floored at zero, rather than the
          -- operator's payout shrinking. Reconstructing the original price
          -- as price_paise + discount_paise and computing commission on
          -- that (not on the already-discounted price_paise) is what makes
          -- a discounted booking's payout come out exactly the same as a
          -- non-discounted one, up to the point the discount exceeds what
          -- this booking's commission could ever have covered. Cancelled
          -- (retained) stays exactly as before — a forfeited deposit/half
          -- payment was never delivered, so none of it was ever the
          -- operator's regardless of any discount.
          case
            when base.is_delivered then
              greatest(0,
                round(greatest(0, base.price_paise + base.discount_paise - base.delivery_paise) * base.bps / 10000.0)::int
                - base.discount_paise
              )
            else
              base.retained
          end as commission_paise,
          case when base.is_delivered and base.pay_mode <> 'full' then base.balance_paise else 0 end
            as cash_paise
        from (
          select
            bi.id, bi.kind, bi.pay_mode, bi.price_paise,
            coalesce(bi.delivery_paise, 0) as delivery_paise,
            coalesce(bi.balance_paise, 0)  as balance_paise,
            coalesce(bi.discount_paise, 0) as discount_paise,
            coalesce(bi.paid_online_paise, 0) - coalesce(bi.refunded_paise, 0) as retained,
            coalesce(v_pbps, 0) as bps,
            (
              bi.redeemed_at is not null
              and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
            ) as is_delivered
          from booking_items bi
          where bi.partner_id = v_partner
            and bi.pay_mode in ('full', 'deposit')
            and not exists (select 1 from settlement_items si where si.booking_item_id = bi.id)
            and (
              (
                bi.redeemed_at is not null
                and (bi.redeemed_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
              )
              or (
                bi.state = 'refunded' and bi.cancelled_at is not null
                and coalesce(bi.paid_online_paise, 0) > coalesce(bi.refunded_paise, 0)
                and (bi.cancelled_at at time zone 'Asia/Kolkata')::date between p_period_start and p_period_end
              )
            )
        ) base
      ) elig
      on conflict (booking_item_id) do nothing;

      select
        count(*), coalesce(sum(gross_paise), 0), coalesce(sum(commission_paise), 0),
        coalesce(sum(cash_collected_paise), 0), coalesce(sum(net_payable_paise), 0)
        into v_count, v_gross, v_commission, v_cash, v_net
      from settlement_items where batch_id = v_batch;

      update settlement_batches set
        gross_paise = v_gross, commission_paise = v_commission,
        cash_collected_paise = v_cash, net_payable_paise = v_net, item_count = v_count
      where id = v_batch;

      return query select v_partner, v_count, v_net;
    end;
  end loop;
end $$;

revoke all on function run_settlement_impl(date, date) from public;

select 'promo discount now comes from commission, not the operator' as done;
