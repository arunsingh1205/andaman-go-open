-- ===========================================================================
-- Migration 137 — commission moves from the category to the business
--
-- Until now every partner of a kind shared one commission rate, set on the
-- admin Revenue page (`commission_rates`, 025/073/097): all cabs paid 15%,
-- all stays 20%, everything else 30%, tables free. That's gone. Commission is
-- now something the admin agrees with each business individually, when they
-- review that business's own registration — a number on the partner's own
-- row, `partners.commission_bps`, set from their detail page and required
-- before the business can be approved.
--
-- What this migration does:
--   1. Adds partners.commission_bps (nullable — see the note at step 9: it's
--      required to *approve* a business, not to *register* one).
--   2. Seeds every existing partner from whatever commission_rates currently
--      charges their category, so nothing changes financially today — admin
--      renegotiates individual businesses from here.
--   3. set_partner_commission(partner, bps) — the new admin write, replacing
--      set_commission_rate(kind, bps).
--   4. Redefines every settlement/reporting view and RPC that used to join
--      commission_rates by booking kind, so they read the specific partner's
--      own rate instead: partner_delivered, partner_cancellations,
--      admin_bookings, run_settlement_impl, create_cab_booking,
--      create_ratecard_cab_booking, create_stay_booking.
--   5. admin_approve_partner refuses to approve a business with no rate set.
--   6. Drops commission_rates and set_commission_rate outright — the old
--      model isn't kept as a fallback, it's removed.
--   7. Bumps the partner agreement version (the copy at /partner-agreement
--      changes alongside this — commission is no longer described as a fixed
--      per-category percentage).
--
-- Every redefined view/function below is copied from its own last live
-- definition — 064 (partner_delivered, partner_cancellations), 097
-- (admin_bookings), 105 (run_settlement_impl), 073 (create_cab_booking), 117
-- (create_ratecard_cab_booking), 103 (create_stay_booking) — with exactly one
-- substitution each: the commission_rates-by-kind lookup becomes a
-- partners.commission_bps-by-partner lookup. Nothing else about them changes.
--
-- Safe to run more than once, except that the commission_rates backfill (step
-- 2) only has anything to read from on the first run, before step 6 drops it
-- — a second run just leaves commission_bps as admin has since set it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The column. Nullable: register_partner creates a business with no
--    commission opinion at all — that's the point, it's required at
--    *approval* (step 9), not at signup. There is exactly one path to
--    status = 'approved' today, so that single RPC guard is enough; no
--    cross-column constraint.
-- ---------------------------------------------------------------------------

alter table partners add column if not exists commission_bps int
  check (commission_bps is null or commission_bps between 0 and 10000);


-- ---------------------------------------------------------------------------
-- 2. Seed every existing partner from today's commission_rates, via the
--    category a business trades in (partners.kind) mapped to the booking
--    category it bills under (commission_rates.kind — a different
--    vocabulary). Reads commission_rates while it still exists; coalesces to
--    30% if a partner's kind somehow has no matching row. Guarded so a
--    second run (after step 11 has already dropped commission_rates) is a
--    no-op here instead of an error.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.commission_rates') is not null then
    update partners p set commission_bps = coalesce(
      (
        select cr.bps from commission_rates cr where cr.kind = case p.kind
          when 'cab'        then 'cab'
          when 'stay'       then 'stay'
          when 'dive'       then 'activity'
          when 'host'       then 'trip'
          when 'venue'      then 'event'
          when 'rental'     then 'rental'
          when 'ferry'      then 'ferry'
          when 'restaurant' then 'table'
        end
      ),
      3000
    )
    where p.commission_bps is null;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. set_partner_commission — mirrors set_commission_rate's shape exactly
--    (025), just keyed on a partner instead of a category.
-- ---------------------------------------------------------------------------

create or replace function set_partner_commission(p_partner_id uuid, p_bps int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    return query select false, 'Commission has to be between 0% and 100%.'::text;
    return;
  end if;

  update partners set commission_bps = p_bps where id = p_partner_id;

  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

-- `from public` alone isn't enough here — this project's default privileges
-- auto-grant EXECUTE to `anon` on every new function regardless (the reason
-- 136 revokes "from public, anon" explicitly); a plain `from public` leaves
-- anon still able to reach it, even though is_admin() inside blocks it from
-- doing anything once there.
revoke all on function set_partner_commission(uuid, int) from public, anon;
grant execute on function set_partner_commission(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. partner_delivered, partner_cancellations — last defined in 064. Same
--    column list, same order; the only change is where commission_bps comes
--    from. CREATE OR REPLACE VIEW is legal here: no column is added, removed
--    or renamed, just re-sourced.
-- ---------------------------------------------------------------------------

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
  i.delivery_paise
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


create or replace view partner_cancellations as
select
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.party,
  i.price_paise,
  i.starts_at,
  i.cancelled_at,
  p2.commission_bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.refunded_paise,
  i.delivery_paise
from booking_items i
join bookings b on b.id = i.booking_id
join partners p2 on p2.id = i.partner_id
where i.state = 'refunded'
  and i.cancelled_at is not null
  and (i.paid_online_paise - i.refunded_paise) > 0
  and exists (
    select 1 from partner_users pu
    where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
  );

alter view partner_cancellations set (security_invoker = on);
grant select on partner_cancellations to authenticated;


-- ---------------------------------------------------------------------------
-- 5. admin_bookings — last defined in 097, already joins partners p for
--    p.name/p.status. Just re-source commission_bps off that same join and
--    drop the commission_rates join.
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
  i.units
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


-- ---------------------------------------------------------------------------
-- 6. run_settlement_impl — last defined in 105. The whole body already runs
--    once per v_partner (the outer loop), so the rate is looked up once per
--    partner (v_pbps) rather than once per row by kind.
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
          -- Delivered: commission is this partner's own rate applied to the
          -- (non-delivery) price, same as always. Cancelled-but-retained
          -- (a forfeited deposit, or the half kept on a late full-payment
          -- cancellation): nothing was delivered, so none of it is owed to
          -- the partner — the whole retained amount is Andaman Go's,
          -- capped here rather than left to a bps-based split. Before
          -- commission was per-partner this fell out for free, because
          -- every category's bps equalled the deposit rate; now that a
          -- partner's own rate can differ from the fixed 30%/50% retained
          -- fractions, capping it explicitly is what keeps that promise
          -- true (a lower-bps partner would otherwise be owed a slice of
          -- money for a booking they never delivered).
          case
            when base.is_delivered then
              round(greatest(0, base.price_paise - base.delivery_paise) * base.bps / 10000.0)::int
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


-- ---------------------------------------------------------------------------
-- 7. create_cab_booking — last defined in 073. v_operator is already resolved
--    a few lines above the old commission_rates read.
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

  -- Payment split. The online amount for 'partial' is exactly this operator's
  -- own agreed commission, read off their partner row; the rest of the fare
  -- is settled with the driver.
  select commission_bps into v_bps from partners where id = v_operator;
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
-- 8. create_ratecard_cab_booking — last defined in 117. v_operator here is
--    always the 'andaman-go-cabs' house partner, resolved a few lines above
--    the old commission_rates read — same substitution.
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

  -- Same cleaning as set_my_phone (007, 117): a bare Indian mobile gets
  -- +91, a stray leading 0 gets stripped first.
  if v_phone ~ '^0[6-9][0-9]{9}$' then
    v_phone := '+91' || substring(v_phone from 2);
  elsif v_phone ~ '^[6-9][0-9]{9}$' then
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

  select commission_bps into v_bps from partners where id = v_operator;
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


-- ---------------------------------------------------------------------------
-- 9. create_stay_booking — last defined in 103, same six-column returns
--    table shape (ref_code, ticket_code, price_paise, paid_online_paise,
--    balance_paise, item_id), so CREATE OR REPLACE FUNCTION is fine here —
--    only earlier transitions needed DROP + CREATE, because *their* return
--    shape changed. v_partner is already resolved above the old read.
-- ---------------------------------------------------------------------------

create or replace function create_stay_booking(
  p_stay                text,
  p_room_type           text,
  p_check_in            date,
  p_nights              int,
  p_party               int  default 1,
  p_pay_mode            text default 'partial',
  p_razorpay_order_id   text default null,
  p_razorpay_payment_id text default null
)
returns table (
  ref_code text, ticket_code text, price_paise int,
  paid_online_paise int, balance_paise int, item_id uuid
)
language plpgsql security definer set search_path = public as $$
declare
  v_user          uuid := auth.uid();
  v_stay_id       uuid;
  v_partner       uuid;
  v_island        text;
  v_check_in_mins int;
  v_room_type_id  uuid;
  v_max_guests    int;
  v_nightly       int;
  v_quantity      int;
  v_price         int;
  v_bps           int;
  v_commission    int;
  v_paid          int;
  v_balance       int;
  v_peak          int;
  v_starts_at     timestamptz;
  v_booking       uuid;
  v_ref           text;
  v_ticket        text;
  v_kind_seq      int;
  v_item          uuid;
  v_phone         text;
  v_email         text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_check_in is null then
    raise exception 'a check-in date is required' using errcode = '22023';
  end if;
  if p_nights is null or p_nights < 1 or p_nights > 180 then
    raise exception 'nights out of range' using errcode = '22023';
  end if;
  if p_party is null or p_party < 1 or p_party > 30 then
    raise exception 'party out of range' using errcode = '22023';
  end if;
  if p_pay_mode not in ('full', 'partial') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;

  -- Same retry shortcut as create_cab_booking: a repeat call carrying a
  -- payment id that already bought a booking returns that booking, not a
  -- new one.
  if p_razorpay_payment_id is not null then
    select b.ref_code, bi.ticket_code, bi.price_paise, bi.paid_online_paise, bi.balance_paise, bi.id
      into v_ref, v_ticket, v_price, v_paid, v_balance, v_item
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where bi.razorpay_payment_id = p_razorpay_payment_id;

    if found then
      return query select v_ref, v_ticket, v_price, v_paid, v_balance, v_item;
      return;
    end if;
  end if;

  select s.id, s.partner_id, s.island_slug, s.check_in_mins
    into v_stay_id, v_partner, v_island, v_check_in_mins
  from stays s
  join partners p on p.id = s.partner_id
  where s.slug = p_stay and s.is_listed and p.status = 'approved';

  if v_stay_id is null then
    raise exception 'nothing bookable found for stay "%"', p_stay using errcode = '22023';
  end if;

  select rt.id, rt.max_guests, rt.nightly_rate_paise, rt.quantity
    into v_room_type_id, v_max_guests, v_nightly, v_quantity
  from stay_room_types rt
  where rt.stay_id = v_stay_id and rt.code = p_room_type;

  if v_room_type_id is null then
    raise exception 'nothing bookable found for room type "%"', p_room_type using errcode = '22023';
  end if;

  if p_party > v_max_guests then
    raise exception 'that room type sleeps at most %', v_max_guests using errcode = '22023';
  end if;

  -- Every stay booking now collects money online (at least the commission),
  -- so a verified payment is always required.
  if p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

  if exists (
    select 1 from listing_closures cl
    cross join generate_series(0, p_nights - 1) as g(n)
    where cl.kind = 'stay' and cl.subject_id = v_room_type_id
      and cl.on_date = p_check_in + g.n
  ) then
    raise exception 'that date is closed to bookings' using errcode = 'P0001';
  end if;

  -- Is this room type free across every night of the stay? Serialise on the
  -- room type, then count the busiest single night the new booking would
  -- touch — same shape as the rental fleet check (035), generalised from
  -- "days" to "nights".
  perform pg_advisory_xact_lock(hashtext('stay_room:' || v_room_type_id::text));

  select coalesce(max(day_load), 0) into v_peak
  from (
    select g.n, count(*) as day_load
    from generate_series(0, p_nights - 1) as g(n)
    join booking_items bi
      on bi.kind = 'stay'
     and bi.stay_room_type_id = v_room_type_id
     and bi.state in ('pending', 'confirmed', 'disrupted', 'completed')
     and (p_check_in + g.n) >= (bi.starts_at at time zone 'Asia/Kolkata')::date
     and (p_check_in + g.n) <  (bi.starts_at at time zone 'Asia/Kolkata')::date + bi.units
    group by g.n
  ) x;

  if v_peak + 1 > v_quantity then
    raise exception 'only % left', greatest(0, v_quantity - v_peak) using errcode = '23514';
  end if;

  v_price := v_nightly * p_nights;

  -- Payment split. The online amount for 'partial' is exactly this
  -- property's own agreed commission, read off their partner row; the rest
  -- of the stay is settled with the property at check-in.
  select commission_bps into v_bps from partners where id = v_partner;
  v_bps := coalesce(v_bps, 2000);
  v_commission := round(v_price * v_bps / 10000.0)::int;

  if p_pay_mode = 'full' then
    v_paid := v_price; v_balance := 0;
  else
    v_paid := v_commission; v_balance := v_price - v_commission;
  end if;

  -- Check-in instant: the property's own check-in time, on the requested date.
  v_starts_at := (p_check_in::timestamp + (v_check_in_mins::text || ' minutes')::interval)
    at time zone 'Asia/Kolkata';

  -- One reference per traveller per day, same as create_booking/create_cab_booking.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = p_check_in limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, v_island, p_check_in, v_phone, v_email)
    returning id into v_booking;
  end if;

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = 'stay';

  v_ticket := v_ref || '-S' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, stay_room_type_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at, razorpay_order_id, razorpay_payment_id)
  values
    (v_booking, 'stay', v_stay_id, v_room_type_id, v_partner, v_starts_at,
     p_party, p_nights, v_price, p_pay_mode, v_paid, v_balance,
     'confirmed', v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id)
  returning id into v_item;

  return query select v_ref, v_ticket, v_price, v_paid, v_balance, v_item;
end $$;

revoke all on function create_stay_booking(
  text, text, date, int, int, text, text, text
) from public;
grant execute on function create_stay_booking(
  text, text, date, int, int, text, text, text
) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 10. admin_approve_partner — refuses a business with no commission set.
--     A bad id still gets its own "no longer exists" message: existence is
--     checked first, the commission check second.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_partner(p_partner_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_bps   int;
  v_found boolean;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select commission_bps into v_bps from partners where id = p_partner_id;
  v_found := found;

  if not v_found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  if v_bps is null then
    return query select false, 'Set a commission rate for this business before approving it.'::text;
    return;
  end if;

  update partners set status = 'approved', rejection_reason = null
  where id = p_partner_id;

  return query select true, 'Approved.'::text;
end;
$$;

revoke all on function admin_approve_partner(uuid) from public;
grant execute on function admin_approve_partner(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 11. The old rate card, dropped outright — not kept as a fallback.
-- ---------------------------------------------------------------------------

drop function if exists set_commission_rate(text, int);
drop table if exists commission_rates;


-- ---------------------------------------------------------------------------
-- 12. Bump the partner agreement version — /partner-agreement's commission
--     section changes alongside this migration (per-business now, not a
--     fixed per-category percentage). Match LAST_UPDATED.partnerAgreement in
--     app/(legal)/legal-meta.ts.
-- ---------------------------------------------------------------------------

create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null,
  p_owner_email text default null,
  p_terms_accepted boolean default false
) returns table (ok boolean, message text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_slug text;
  v_id uuid;
  v_phone_clean text;
  v_phone_last10 text;
  v_dupe_id uuid;
  v_dupe_name text;
  v_owner_email text := lower(trim(coalesce(p_owner_email, '')));
  v_my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  -- Bump this whenever the wording at /partner-agreement changes materially,
  -- and match LAST_UPDATED.partnerAgreement in app/(legal)/legal-meta.ts.
  -- 2026-09-22: commission moves from a fixed per-category rate to one
  -- negotiated per business (137).
  v_terms_version constant text := '2026-09-22';
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return query select
      false,
      'Sign in with Google before registering your business.'::text,
      null::uuid;
    return;
  end if;

  select pu.partner_id into v_existing from partner_users pu where pu.user_id = auth.uid();
  if v_existing is not null then
    return query select false, 'This account is already linked to a business.'::text, v_existing;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Business name is required.'::text, null::uuid;
    return;
  end if;
  if p_kind not in ('dive', 'ferry', 'rental', 'venue', 'host', 'cab', 'stay') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;
  if not coalesce(p_terms_accepted, false) then
    return query select false, 'Please read and accept the Partner Agreement to register.'::text, null::uuid;
    return;
  end if;
  if v_owner_email <> '' and v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That backup email doesn''t look right.'::text, null::uuid;
    return;
  end if;

  v_phone_clean := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9+]', '', 'g');
  if v_phone_clean ~ '^0[6-9][0-9]{9}$' then
    v_phone_clean := '+91' || substring(v_phone_clean from 2);
  elsif v_phone_clean ~ '^[6-9][0-9]{9}$' then
    v_phone_clean := '+91' || v_phone_clean;
  elsif v_phone_clean ~ '^91[6-9][0-9]{9}$' then
    v_phone_clean := '+' || v_phone_clean;
  end if;
  v_phone_last10 := right(regexp_replace(v_phone_clean, '[^0-9]', '', 'g'), 10);

  if v_phone_last10 <> '' then
    select p.id, p.name into v_dupe_id, v_dupe_name
    from partners p
    where right(regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_last10
    limit 1;

    if v_dupe_id is not null then
      return query select
        false,
        format(
          'A business with this phone number is already registered (%s). If that''s you, sign out and sign back in with the Google account you used the first time. Message Andaman Go if you can''t get to it.',
          v_dupe_name
        ),
        v_dupe_id;
      return;
    end if;
  end if;

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (
    slug, name, kind, island_slug, contact_phone, whatsapp_number, address, maps_url, status,
    terms_accepted_at, terms_version
  )
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(v_phone_clean, ''), nullif(v_phone_clean, ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending',
    now(), v_terms_version
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  if v_owner_email <> '' and v_owner_email <> v_my_email then
    insert into partner_invites (partner_id, email, role, invited_by)
    values (v_id, v_owner_email, 'owner', auth.uid());
  end if;

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;


-- ---------------------------------------------------------------------------
-- 13. Check: every partner now has a commission opinion or explicitly none.
-- ---------------------------------------------------------------------------

select
  count(*) as total_partners,
  count(commission_bps) as with_commission_set
from partners;
