-- ===========================================================================
-- Migration 103 — actually fire the partner API's outbound webhook (099)
--
-- Saving a webhook_url on an API key has worked since 099, but nothing ever
-- called it — lib/stay-webhook.ts, referenced in a comment in
-- app/api/partner/v1/bookings/route.ts, was never built. This wires it up:
-- create_stay_booking now also returns the booking_items.id it just
-- inserted, and a new get_stay_webhook_targets() lets the Node side (which
-- has no service-role client anywhere in this codebase — everything goes
-- through the anon key + a security definer RPC, same as
-- apply_razorpay_refund_webhook) look up which of that booking's partner's
-- keys have a webhook_url set, without ever exposing key_hash/webhook_secret
-- through a plain select.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. create_stay_booking (097) gains one output column: item_id, the
--    booking_items.id it just wrote (or found, on a retried payment id).
--    Postgres won't let CREATE OR REPLACE change a RETURNS TABLE column set,
--    so this drops and recreates it — same grants as before, plus the
--    existing (text,text,date,int,int,text,text,text) signature is
--    untouched, so nothing that calls it needs to change except the one
--    extra column it now gets back.
-- ---------------------------------------------------------------------------

drop function if exists create_stay_booking(text, text, date, int, int, text, text, text);

create function create_stay_booking(
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

  return query select v_ref, v_ticket, v_price, v_paid, v_balance, v_item;
end $$;

revoke all on function create_stay_booking(
  text, text, date, int, int, text, text, text
) from public;
grant execute on function create_stay_booking(
  text, text, date, int, int, text, text, text
) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 2. get_stay_webhook_targets — the Node side (lib/stay-webhook.ts) calls
--    this right after a booking succeeds, keyed only by the booking_items.id
--    it just got back (an unguessable uuid nobody else has yet seen — the
--    same trust boundary api_push_stay_availability/api_list_partner_bookings
--    already rely on for their key_prefix+key_hash pair). Never exposes
--    key_hash; webhook_secret only goes out over this one path, to be used
--    immediately for the HMAC signature and not stored client-side.
-- ---------------------------------------------------------------------------

create or replace function get_stay_webhook_targets(p_booking_item_id uuid)
returns table (webhook_url text, webhook_secret text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select partner_id into v_partner
  from booking_items
  where id = p_booking_item_id and kind = 'stay';

  if v_partner is null then
    return;
  end if;

  return query
    select k.webhook_url, k.webhook_secret
    from api_keys k
    where k.partner_id = v_partner
      and k.revoked_at is null
      and k.webhook_url is not null;
end $$;

revoke all on function get_stay_webhook_targets(uuid) from public;
grant execute on function get_stay_webhook_targets(uuid) to authenticated, anon;

select 'stay outbound webhook wired up' as done;
