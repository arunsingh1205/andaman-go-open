-- ===========================================================================
-- Migration 097 — Stays & Homestays: commission, payment split, booking
--
-- Andaman Go takes 20% on a stay booking (commission_rates('stay') = 2000
-- bps) — its own independent rate, unrelated to cabs' 15% (073). At
-- checkout the traveller picks one of two payment modes, mirroring cabs'
-- 'partial'/'full' shape exactly:
--   * 'partial' — pay just the 20% commission online now; the rest is owed
--     to the property in person at check-in.
--   * 'full'    — pay the whole stay online now. Andaman Go then holds the
--     host's ~80% share until the weekly settlement run (098) pays it out.
--
-- category_payment('stay') is set to 'choice' because that's what the admin
-- commission/payment-mode screen displays — but exactly like cabs (073's own
-- note), the real split math is bespoke (lib/stays.ts::stayPaymentSplit`),
-- not the generic 30%-deposit path in lib/payments.ts/app/pay-choice.tsx.
--
-- create_stay_booking mirrors create_cab_booking (073) almost exactly: a
-- verified Razorpay payment is always required, an advisory lock plus a
-- peak-overlap count (the same shape 035 gave rentals, generalised from
-- "days" to "nights") guards a room type's `quantity`, and a night already
-- in `listing_closures` refuses the booking outright.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The rate card: stays are 20%. category_payment('stay') = 'choice' is a
--    label for the admin screen — the actual split lives in lib/stays.ts.
-- ---------------------------------------------------------------------------

insert into commission_rates (kind, bps, updated_at) values ('stay', 2000, now())
on conflict (kind) do update set bps = 2000, updated_at = now();

insert into category_payment (kind, mode) values ('stay', 'choice')
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------------
-- 2. create_stay_booking — the one door. Fare, the closure check, and the
--    "is this room type free across these nights" check all happen here,
--    never trusted from the browser.
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
  paid_online_paise int, balance_paise int
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
    select b.ref_code, bi.ticket_code, bi.price_paise, bi.paid_online_paise, bi.balance_paise
      into v_ref, v_ticket, v_price, v_paid, v_balance
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where bi.razorpay_payment_id = p_razorpay_payment_id;

    if found then
      return query select v_ref, v_ticket, v_price, v_paid, v_balance;
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

  -- Payment split. The online amount for 'partial' is exactly Andaman Go's
  -- commission, read from the same rate card the admin edits; the rest of
  -- the stay is settled with the property at check-in.
  select bps into v_bps from commission_rates where kind = 'stay';
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

  return query select v_ref, v_ticket, v_price, v_paid, v_balance;
end $$;

revoke all on function create_stay_booking(
  text, text, date, int, int, text, text, text
) from public;
grant execute on function create_stay_booking(
  text, text, date, int, int, text, text, text
) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 3. cancel_my_booking_item already treats 'partial' as non-refundable
--    (v_mode in ('deposit', 'partial'), 073) — a stay's commission-online
--    booking gets that for free, no change needed here.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 3a. notify_partner_of_booking — the "N guests" line becomes "N nights ·
--     M guests" for a stay. Body carried over from 020, one branch added to
--     v_party. Untouched otherwise: the same trigger already fires
--     unconditionally on every booking_items row, 'stay' included.
-- ---------------------------------------------------------------------------

create or replace function notify_partner_of_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_when  text;
  v_party text;
begin
  v_party := case
    when coalesce(new.kind, old.kind) = 'table'
      then 'Table for ' || coalesce(new.party, old.party)
    when coalesce(new.kind, old.kind) = 'stay'
      then coalesce(new.units, old.units) || case when coalesce(new.units, old.units) = 1 then ' night · ' else ' nights · ' end
           || coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' guest' else ' guests' end
    when coalesce(new.kind, old.kind) = 'ferry'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' adult' else ' adults' end
    when coalesce(new.kind, old.kind) = 'trip'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' seat' else ' seats' end
    else coalesce(new.party, old.party)
         || case when coalesce(new.party, old.party) = 1 then ' guest' else ' guests' end
  end;

  if TG_OP = 'INSERT' then
    v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
    v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      new.partner_id,
      'booking_new',
      case when new.state = 'pending'
        then 'New booking — needs your confirmation'
        else 'New booking' end,
      v_title || ' · ' || v_when || ' · ' || v_party,
      new.id
    );
    return null;
  end if;

  if TG_OP = 'UPDATE' and old.state is distinct from new.state then
    if new.state = 'refunded'
       and new.cancelled_note is not null
       and coalesce(old.cancelled_note, '') is distinct from new.cancelled_note then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_cancelled',
        'Booking cancelled by Andaman Go',
        v_title || ' · ' || v_when || ' — ' || new.cancelled_note,
        new.id
      );

    elsif new.state = 'disrupted' then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_disrupted',
        'Booking disrupted — weather',
        v_title || ' · ' || v_when || ' · ' || v_party,
        new.id
      );
    end if;

    return null;
  end if;

  return null;
end $$;


-- ---------------------------------------------------------------------------
-- 3b. my_bookings / admin_bookings / partner_bookings — append `units`
--     (nights, for a stay; already meant "days" for a rental), and for
--     admin_bookings also stay_room_type_id, same as cab_id/driver_id (079).
--
--     CREATE OR REPLACE VIEW can only ever APPEND columns, never reorder or
--     drop one — so each body below is the view's real, current definition
--     (confirmed against the live database with pg_get_viewdef, not assumed
--     from an earlier local migration file — my_bookings in particular
--     already carries a driver_name/driver_phone join this file's own
--     history doesn't otherwise show) with the new column(s) added at the
--     very end and nothing else touched.
-- ---------------------------------------------------------------------------

create or replace view my_bookings as
select
  i.id                                as item_id,
  b.id                                as booking_id,
  b.ref_code,
  b.on_date,
  b.island_slug,
  isl.name                            as island_name,
  i.kind,
  i.subject_id,
  subject_title(i.kind, i.subject_id) as title,
  partner_name(i.partner_id)          as operator,
  i.starts_at,
  i.party,
  i.price_paise,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  subject_maps_url(i.kind, i.subject_id, i.partner_id) as maps_url,
  subject_address(i.kind, i.subject_id, i.partner_id)  as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating,
  partner_phone(i.partner_id)         as operator_phone,
  i.refund_status,
  cd.name  as driver_name,
  cd.phone as driver_phone,
  i.units
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug
left join cab_drivers cd on cd.id = i.driver_id;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


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
  cr.bps          as commission_bps,
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
  i.refunded_paise,
  i.units
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);
revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;


-- ---------------------------------------------------------------------------
-- 5. stay_room_load — how many of a room type are booked out per night in a
--    date range, mirroring cab_load_on (049): a SECURITY DEFINER function
--    (not a bare `security_invoker = false` view — Supabase's linter flags
--    that shape as a security_definer_view ERROR, and a function sidesteps
--    it while doing the exact same intentional thing) so a logged-out
--    traveller can see a room type is sold out before anyone taps Book,
--    the same trade `availability` and cab_load_on already make.
-- ---------------------------------------------------------------------------

create or replace function stay_room_load(p_room_type_ids uuid[], p_from date, p_to date)
returns table (stay_room_type_id uuid, on_date date, out_count bigint)
language sql stable security definer set search_path = public as $$
  select
    i.stay_room_type_id,
    (i.starts_at at time zone 'Asia/Kolkata')::date + g.n as on_date,
    count(*) as out_count
  from booking_items i
  cross join lateral generate_series(0, i.units - 1) as g(n)
  where i.kind = 'stay'
    and i.stay_room_type_id = any (p_room_type_ids)
    and i.state in ('pending', 'confirmed', 'disrupted', 'completed')
    and (i.starts_at at time zone 'Asia/Kolkata')::date + g.n >= p_from
    and (i.starts_at at time zone 'Asia/Kolkata')::date + g.n <  p_to
  group by i.stay_room_type_id, (i.starts_at at time zone 'Asia/Kolkata')::date + g.n
$$;

revoke all on function stay_room_load(uuid[], date, date) from public;
grant execute on function stay_room_load(uuid[], date, date) to anon, authenticated;


select
  'stays booking + payment installed' as done,
  (select bps from commission_rates where kind = 'stay') as stay_bps,
  (select mode from category_payment where kind = 'stay') as stay_payment_mode;
