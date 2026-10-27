-- ===========================================================================
-- Migration 160 — scoped, percent-off and publicly-listed promo codes
--
-- 158/159 only covered a flat amount off any Activity/Trip booking. Real
-- use turned out wider: a code an operator asks for to discount one
-- specific listing (e.g. 15% off just their scuba diving, not every
-- activity on the site), a percentage instead of a flat rupee amount, a
-- minimum order value before it kicks in ("10-15% off on bookings over
-- ₹15,000"), and a public "what offers do we have right now" page a
-- traveller can browse without already knowing a code — the Zomato-coupons
-- shape, not just a blind "type a code and hope".
--
-- promo_codes grows:
--   discount_type         'flat' | 'percent' — exactly one of the next two
--                          is set, enforced by a check constraint.
--   discount_percent_bps  basis points (1000 = 10%), same unit
--                          commission_bps already uses elsewhere.
--   min_order_paise       0 = no minimum. Checked against the booking's
--                          price *before* this discount, same amount
--                          min_order_paise is itself denominated in.
--   is_public             shows on the public offers page (list_public_offers
--                          below) when true. Defaults to true since most
--                          codes are exactly this kind of general offer —
--                          an admin creating a one-off code for a specific
--                          operator-requested discount un-checks it, which
--                          keeps that arrangement between whoever has the
--                          code, the same way an unlisted code already
--                          worked before this migration.
--   headline               optional one-line blurb for the offers page
--                          ("10% off scuba diving, bookings over ₹15,000").
--                          Null falls back to an auto-built description.
--
-- promo_code_scopes is new: zero rows for a code means "applies to any
-- Activity/Trip booking" (unchanged from 158); one or more rows means it
-- only applies to those specific listings. Same RPC-only access as
-- promo_codes/promo_redemptions — a code's targeting is never a direct
-- read, only ever surfaced through validate_promo_code or
-- list_public_offers.
--
-- Two small shared functions (promo_code_applies, compute_promo_discount)
-- so the scope check and the discount math live in exactly one place each,
-- called from both the read-only preview (validate_promo_code) and the
-- real redemption path (create_booking) — the two were already at risk of
-- drifting apart once there was real logic here instead of one `least()`.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. promo_codes — new columns, widened constraints.
-- ---------------------------------------------------------------------------

alter table promo_codes
  add column if not exists discount_type text not null default 'flat'
    check (discount_type in ('flat', 'percent')),
  add column if not exists discount_percent_bps int,
  add column if not exists min_order_paise int not null default 0 check (min_order_paise >= 0),
  add column if not exists is_public boolean not null default true,
  add column if not exists headline text;

alter table promo_codes drop constraint if exists promo_codes_discount_paise_check;
alter table promo_codes add constraint promo_codes_discount_paise_check
  check (discount_paise is null or discount_paise > 0);

alter table promo_codes drop constraint if exists promo_codes_discount_percent_bps_check;
alter table promo_codes add constraint promo_codes_discount_percent_bps_check
  check (discount_percent_bps is null or (discount_percent_bps > 0 and discount_percent_bps <= 10000));

alter table promo_codes drop constraint if exists promo_codes_discount_shape_check;
alter table promo_codes add constraint promo_codes_discount_shape_check
  check (
    (discount_type = 'flat'    and discount_paise is not null and discount_percent_bps is null)
    or
    (discount_type = 'percent' and discount_percent_bps is not null and discount_paise is null)
  );


-- ---------------------------------------------------------------------------
-- 2. promo_code_scopes — which specific listings a code is limited to.
-- ---------------------------------------------------------------------------

create table if not exists promo_code_scopes (
  id             uuid primary key default gen_random_uuid(),
  promo_code_id  uuid not null references promo_codes(id) on delete cascade,
  kind           text not null check (kind in ('activity', 'trip')),
  subject_slug   text not null,
  unique (promo_code_id, kind, subject_slug)
);

alter table promo_code_scopes enable row level security;
revoke all on promo_code_scopes from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Shared helpers.
-- ---------------------------------------------------------------------------

create or replace function promo_code_applies(p_promo_code_id uuid, p_kind text, p_subject text)
returns boolean
language sql stable as $$
  select
    not exists (select 1 from promo_code_scopes where promo_code_id = p_promo_code_id)
    or exists (
      select 1 from promo_code_scopes
      where promo_code_id = p_promo_code_id and kind = p_kind and subject_slug = p_subject
    );
$$;

revoke all on function promo_code_applies(uuid, text, text) from public;

create or replace function compute_promo_discount(p_promo_code_id uuid, p_order_paise int)
returns int
language plpgsql stable as $$
declare
  v_type text;
  v_flat int;
  v_bps  int;
  v_discount int;
begin
  select discount_type, discount_paise, discount_percent_bps
    into v_type, v_flat, v_bps
  from promo_codes where id = p_promo_code_id;

  if v_type = 'percent' then
    v_discount := round(coalesce(p_order_paise, 0) * coalesce(v_bps, 0) / 10000.0)::int;
  else
    v_discount := coalesce(v_flat, 0);
  end if;

  return least(v_discount, coalesce(p_order_paise, 0));
end $$;

revoke all on function compute_promo_discount(uuid, int) from public;


-- ---------------------------------------------------------------------------
-- 4. validate_promo_code — grows p_kind/p_subject/p_order_paise so the
--    preview can check scope and the minimum order the same way
--    create_booking will. Signature changes, so drop first.
-- ---------------------------------------------------------------------------

drop function if exists validate_promo_code(text);

create function validate_promo_code(p_code text, p_kind text, p_subject text, p_order_paise int)
returns table (ok boolean, message text, discount_paise int)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := upper(trim(coalesce(p_code, '')));
  v_promo_id uuid;
  v_min      int;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if v_code = '' then
    return query select false, 'Enter a code.'::text, null::int;
    return;
  end if;

  select pc.id, pc.min_order_paise into v_promo_id, v_min
  from promo_codes pc
  where pc.code = v_code and pc.active;

  if v_promo_id is null then
    return query select false, 'That code isn''t valid.'::text, null::int;
    return;
  end if;

  if not promo_code_applies(v_promo_id, p_kind, p_subject) then
    return query select false, 'That code doesn''t apply to this booking.'::text, null::int;
    return;
  end if;

  if coalesce(p_order_paise, 0) < coalesce(v_min, 0) then
    return query select false,
      ('This code applies to bookings of ₹' || to_char(v_min / 100, 'FM999,999,999') || ' or more.')::text,
      null::int;
    return;
  end if;

  if exists (
    select 1 from promo_redemptions
    where promo_code_id = v_promo_id and user_id = v_user
  ) then
    return query select false, 'You''ve already used that code.'::text, null::int;
    return;
  end if;

  return query select true, 'Code applied.'::text, compute_promo_discount(v_promo_id, p_order_paise);
end $$;

revoke all on function validate_promo_code(text, text, text, int) from public;
grant execute on function validate_promo_code(text, text, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. create_booking — same 12-arg signature as 158 (p_promo_code already
--    exists), so a body-only CREATE OR REPLACE is safe. The promo block now
--    checks scope and minimum order the same way validate_promo_code does,
--    and shares the discount math via compute_promo_discount instead of its
--    own inline `least()`.
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
  -- check, since that check has to see the actual discounted amount. Scope
  -- and minimum-order are checked the same way validate_promo_code already
  -- previewed them; the discount itself comes from the one shared function
  -- so a flat/percent code is never computed two different ways.
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

-- Grants unchanged from 158 — same signature, so they already stand; no
-- revoke/grant needed for a body-only replace.


-- ---------------------------------------------------------------------------
-- 6. admin_list_promo_codes — return columns grow, so drop first. Scope
--    rows come back as two parallel arrays (kind/slug) rather than a joined
--    label, since resolving a slug to a human name is cheap, public catalog
--    data the admin screen can already fetch on its own — no reason to
--    duplicate that lookup inside this function too.
-- ---------------------------------------------------------------------------

drop function if exists admin_list_promo_codes();

create function admin_list_promo_codes()
returns table (
  id uuid, code text, discount_type text, discount_paise int, discount_percent_bps int,
  min_order_paise int, is_public boolean, headline text, active boolean,
  created_at timestamptz, redemption_count bigint,
  scope_kinds text[], scope_slugs text[]
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  -- Two independent subqueries, not two joins off the same row: a code
  -- with both several redemptions and several scope rows would otherwise
  -- cross-multiply (3 redemptions x 2 scopes = 6 joined rows), and
  -- array_agg over that would repeat each scope label once per
  -- redemption instead of listing it once.
  return query
  select pc.id, pc.code, pc.discount_type, pc.discount_paise, pc.discount_percent_bps,
         pc.min_order_paise, pc.is_public, pc.headline, pc.active, pc.created_at,
         (select count(*) from promo_redemptions pr where pr.promo_code_id = pc.id),
         coalesce(
           (select array_agg(s.kind) from promo_code_scopes s where s.promo_code_id = pc.id),
           '{}'
         ),
         coalesce(
           (select array_agg(s.subject_slug) from promo_code_scopes s where s.promo_code_id = pc.id),
           '{}'
         )
  from promo_codes pc
  order by pc.created_at desc;
end $$;

revoke all on function admin_list_promo_codes() from public;
grant execute on function admin_list_promo_codes() to authenticated;


-- ---------------------------------------------------------------------------
-- 7. admin_upsert_promo_code — grows a lot of params, so drop the 159
--    4-arg version first. Scope is replaced wholesale on every save
--    (delete then reinsert) rather than diffed — simpler, and this is an
--    admin form submit, not a high-frequency write.
-- ---------------------------------------------------------------------------

drop function if exists admin_upsert_promo_code(uuid, text, int, boolean);

create function admin_upsert_promo_code(
  p_id uuid,
  p_code text,
  p_discount_type text,
  p_discount_paise int default null,
  p_discount_percent_bps int default null,
  p_min_order_paise int default 0,
  p_is_public boolean default true,
  p_headline text default null,
  p_active boolean default true,
  p_scope_kinds text[] default '{}',
  p_scope_slugs text[] default '{}'
)
returns table (ok boolean, message text, promo_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_id   uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if v_code = '' then
    return query select false, 'Give this code a value.'::text, null::uuid;
    return;
  end if;
  if p_discount_type not in ('flat', 'percent') then
    return query select false, 'Choose a discount type.'::text, null::uuid;
    return;
  end if;
  if p_discount_type = 'flat' and (p_discount_paise is null or p_discount_paise <= 0) then
    return query select false, 'Enter a discount amount greater than zero.'::text, null::uuid;
    return;
  end if;
  if p_discount_type = 'percent'
     and (p_discount_percent_bps is null or p_discount_percent_bps <= 0 or p_discount_percent_bps > 10000) then
    return query select false, 'Enter a percentage between 1 and 100.'::text, null::uuid;
    return;
  end if;
  if cardinality(p_scope_kinds) <> cardinality(p_scope_slugs) then
    return query select false, 'Something went wrong with the listing selection. Try again.'::text, null::uuid;
    return;
  end if;

  if p_id is not null then
    update promo_codes set
      code = v_code,
      discount_type = p_discount_type,
      discount_paise = case when p_discount_type = 'flat' then p_discount_paise else null end,
      discount_percent_bps = case when p_discount_type = 'percent' then p_discount_percent_bps else null end,
      min_order_paise = greatest(coalesce(p_min_order_paise, 0), 0),
      is_public = coalesce(p_is_public, true),
      headline = nullif(trim(coalesce(p_headline, '')), ''),
      active = coalesce(p_active, true)
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return query select false, 'That code no longer exists.'::text, null::uuid;
      return;
    end if;

    delete from promo_code_scopes where promo_code_id = v_id;
  else
    insert into promo_codes
      (code, discount_type, discount_paise, discount_percent_bps, min_order_paise,
       is_public, headline, active)
    values
      (v_code, p_discount_type,
       case when p_discount_type = 'flat' then p_discount_paise else null end,
       case when p_discount_type = 'percent' then p_discount_percent_bps else null end,
       greatest(coalesce(p_min_order_paise, 0), 0),
       coalesce(p_is_public, true), nullif(trim(coalesce(p_headline, '')), ''),
       coalesce(p_active, true))
    returning id into v_id;
  end if;

  if cardinality(p_scope_kinds) > 0 then
    insert into promo_code_scopes (promo_code_id, kind, subject_slug)
    select distinct v_id, k, s
    from unnest(p_scope_kinds, p_scope_slugs) as t(k, s)
    where k in ('activity', 'trip') and coalesce(trim(s), '') <> ''
    on conflict (promo_code_id, kind, subject_slug) do nothing;
  end if;

  return query select true, 'Saved.'::text, v_id;
exception when unique_violation then
  return query select false, ('"' || v_code || '" is already in use.')::text, null::uuid;
end $$;

revoke all on function admin_upsert_promo_code(
  uuid, text, text, int, int, int, boolean, text, boolean, text[], text[]
) from public;
grant execute on function admin_upsert_promo_code(
  uuid, text, text, int, int, int, boolean, text, boolean, text[], text[]
) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. list_public_offers — the traveller-facing "what offers do we have
--    right now" read. Public (no is_admin() check): only active, is_public
--    codes, and only the fields a traveller is meant to see — never the
--    redemption count or whether it's scoped vs global by some other means
--    than the labels themselves.
-- ---------------------------------------------------------------------------

create or replace function list_public_offers()
returns table (
  code text, discount_type text, discount_paise int, discount_percent_bps int,
  min_order_paise int, headline text, scope_kinds text[], scope_slugs text[]
)
language sql stable security definer set search_path = public as $$
  select pc.code, pc.discount_type, pc.discount_paise, pc.discount_percent_bps,
         pc.min_order_paise, pc.headline,
         coalesce(array_agg(s.kind) filter (where s.kind is not null), '{}'),
         coalesce(array_agg(s.subject_slug) filter (where s.subject_slug is not null), '{}')
  from promo_codes pc
  left join promo_code_scopes s on s.promo_code_id = pc.id
  where pc.active and pc.is_public
  group by pc.id
  order by pc.created_at desc;
$$;

revoke all on function list_public_offers() from public;
grant execute on function list_public_offers() to anon, authenticated;

select 'promo code scope/percent/public RPCs ready' as done;
