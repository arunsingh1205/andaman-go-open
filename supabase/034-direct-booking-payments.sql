-- ===========================================================================
-- Migration 034 — direct booking, paid up front, no approval step
--
-- Until now activity / trip / rental bookings were born 'pending': the
-- traveller sent a request, the operator accepted or declined it (010), and
-- payment was an imagined "WhatsApp payment link" that never got built. The
-- confirmation screen still says "Request sent … you'll get a payment link".
--
-- This migration turns that around. A booking is CONFIRMED the moment it is
-- made, and it carries how it was paid:
--
--   * pay_mode 'full'    — the whole price was taken online.
--   * pay_mode 'deposit' — a flat 30% was taken online; the rest is owed to
--                          the operator in person, on the day.
--
-- Whether the deposit option is offered is a per-CATEGORY policy the admin
-- console owns — some categories (ferries, events, stays) are always paid in
-- full, a restaurant table is free. That policy lives in `category_payment`,
-- shaped exactly like `commission_rates` (025): one row per kind, one admin
-- RPC to change it, readable by everyone because the booking screens need it.
--
-- There is still no real money and no gateway — "Pay now" is a button. What
-- changes is the STATE MACHINE and the SHAPE of a booking_item, so the gateway
-- has somewhere to land later.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. category_payment — is a deposit allowed, per booking kind.
--
--   'free'   — nothing is charged (restaurant tables).
--   'full'   — the whole price, online, every time.
--   'choice' — the traveller picks 30% now or 100% now.
--
-- Same discipline as commission_rates: not secret (the booking screen reads
-- it to decide whether to draw the deposit toggle), writes go through the
-- admin RPC below.
-- ---------------------------------------------------------------------------

create table if not exists category_payment (
  kind       text primary key check (kind in
               ('activity', 'ferry', 'table', 'event', 'stay', 'trip', 'rental')),
  mode       text not null check (mode in ('free', 'full', 'choice')),
  updated_at timestamptz not null default now()
);

insert into category_payment (kind, mode) values
  ('activity', 'choice'),
  ('trip',     'choice'),
  ('rental',   'choice'),
  ('ferry',    'full'),
  ('event',    'full'),
  ('stay',     'full'),
  ('table',    'free')
on conflict (kind) do nothing;

alter table category_payment enable row level security;

drop policy if exists "category payment is readable" on category_payment;
create policy "category payment is readable" on category_payment
  for select using (true);

grant select on category_payment to anon, authenticated;


create or replace function set_category_payment(p_kind text, p_mode text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind not in ('activity', 'ferry', 'table', 'event', 'stay', 'trip', 'rental') then
    return query select false, 'Unknown category.'::text;
    return;
  end if;

  if p_mode not in ('free', 'full', 'choice') then
    return query select false, 'Payment mode has to be free, full or choice.'::text;
    return;
  end if;

  insert into category_payment (kind, mode, updated_at)
  values (p_kind, p_mode, now())
  on conflict (kind) do update set mode = excluded.mode, updated_at = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_category_payment(text, text) from public;
grant execute on function set_category_payment(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. booking_items grows the money it needs to settle later, plus the two
--    facts a rental needs so 035 can count a finite fleet.
--
--   pay_mode          — 'full' or 'deposit', as above.
--   paid_online_paise — what was actually taken online (deposit or full).
--   balance_paise     — what is still owed at the counter (0 when paid full).
--   refunded_paise    — what has been handed back on a cancellation (036).
--   units             — days for a rental, nights for a stay, 1 otherwise.
--                       Passed to create_booking() since 004, never stored;
--                       035's overlap check can't work without it.
--   variant_id        — which vehicle, for a rental. Same story: passed as
--                       p_variant, used only for pricing, never recorded.
-- ---------------------------------------------------------------------------

alter table booking_items
  add column if not exists pay_mode text not null default 'full'
    check (pay_mode in ('full', 'deposit'));
alter table booking_items
  add column if not exists paid_online_paise int not null default 0
    check (paid_online_paise >= 0);
alter table booking_items
  add column if not exists balance_paise int not null default 0
    check (balance_paise >= 0);
alter table booking_items
  add column if not exists refunded_paise int not null default 0
    check (refunded_paise >= 0);
alter table booking_items
  add column if not exists units int not null default 1 check (units > 0);
alter table booking_items
  add column if not exists variant_id uuid references vehicles(id);


-- ---------------------------------------------------------------------------
-- 3. create_booking — still the only door, now paid on the way in.
--
-- Whole body carried over from 021, with four changes, all marked >>> 034:
--   a. a new last argument, p_pay_mode, so the old positional signature is
--      dropped and re-granted with the extra text param.
--   b. the rental lookup also grabs the vehicle's own id (v_variant_id).
--   c. category_payment decides what p_pay_mode is allowed, and the 30% split
--      is worked out here — never sent from the browser, same rule as price.
--   d. every kind is 'confirmed' from the start and gets a ticket; the
--      pending branch and its "someone has to say yes" comment are gone.
-- ---------------------------------------------------------------------------

drop function if exists create_booking(text, text, timestamptz, int, int, text, boolean);

create or replace function create_booking(
  p_kind      text,
  p_subject   text,
  p_starts_at timestamptz,
  p_party     int  default 1,
  p_units     int  default 1,
  p_variant   text default null,
  p_extras    boolean default false,
  p_pay_mode  text default 'full'                                   -- >>> 034
)
returns table (
  ref_code text, ticket_code text, price_paise int, state text,
  paid_online_paise int, balance_paise int                         -- >>> 034
)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_subject_id uuid;
  v_partner_id uuid;
  v_variant_id uuid;                                                -- >>> 034
  v_island     text;
  v_price      int;
  v_capacity   int;
  v_taken      int;
  v_needed     int := p_party;
  v_mode       text;                                                -- >>> 034
  v_deposit    int;                                                 -- >>> 034
  v_paid       int;                                                 -- >>> 034
  v_balance    int;                                                 -- >>> 034
  v_state      text;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
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
      -- >>> 034: v.id as well, so booking_items records which vehicle went
      -- out. Stock is still not checked here — that lands in 035.
      select p.id, v.id, p.id, p.island_slug,
             v.rate_paise * p_units + case when p_extras then 10000 else 0 end,
             null
        into v_subject_id, v_variant_id, v_partner_id, v_island, v_price, v_capacity
      from partners p
      join vehicles v on v.partner_id = p.id and v.code = p_variant and v.is_listed
      where p.slug = p_subject and p.status = 'approved';

    when 'stay' then
      select s.id, s.partner_id, s.island_slug, s.price_paise * p_units, null
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from stays s
      where s.slug = p_subject and s.is_listed;

    else
      raise exception 'unknown booking kind "%"', p_kind using errcode = '22023';
  end case;

  if v_subject_id is null then
    raise exception 'nothing bookable found for % "%"', p_kind, p_subject using errcode = '22023';
  end if;

  -- 021: the operator has closed this date.
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

  -- >>> 034: what may this category be paid with, and — if a deposit — how
  -- much is due now. The 30% is computed here, off the catalogue price, and
  -- never trusted from the request.
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
  -- <<< 034

  -- >>> 034: no more pending. Nobody has to accept a booking that has already
  -- been paid for — the operator runs it, and cancels it if they truly can't.
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

  v_ticket := v_ref || '-' || upper(left(p_kind, 1));                -- >>> 034

  insert into booking_items
    (booking_id, kind, subject_id, variant_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     p_party, p_units, v_price, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now());

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;

revoke all on function
  create_booking(text, text, timestamptz, int, int, text, boolean, text) from public;
grant execute on function
  create_booking(text, text, timestamptz, int, int, text, boolean, text)
  to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 4. confirm_booking / decline_booking (010) retire.
--
-- Nothing is ever 'pending' now, so "accept this" has no meaning. "I can't
-- take this after all" still does — that becomes partner_cancel_booking_item,
-- which unlike decline_booking demands a reason (the traveller reads it) and
-- records the refund it owes. Full body of the refund maths is in 036; this
-- is the operator's door into it.
-- ---------------------------------------------------------------------------

drop function if exists confirm_booking(uuid);
drop function if exists decline_booking(uuid);

create or replace function partner_cancel_booking_item(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_state    text;
  v_paid     int;
  v_starts   timestamptz;
  v_kind     text;
  v_subject  uuid;
  v_title    text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason — the traveller sees this.'::text;
    return;
  end if;

  select i.state, i.paid_online_paise, i.starts_at, i.kind, i.subject_id
    into v_state, v_paid, v_starts, v_kind, v_subject
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  -- The operator backing out means the traveller is made whole — everything
  -- they paid online comes back. sync_availability() (004) reopens the slot
  -- off the state change without needing to know an operator did this.
  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason)
  where id = p_item_id;

  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'You cancelled a booking',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, 'Cancelled and refunded.'::text;
end $$;

revoke all on function partner_cancel_booking_item(uuid, text) from public;
grant execute on function partner_cancel_booking_item(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. my_bookings and partner_bookings carry the payment split.
--
-- my_bookings has to be dropped and rebuilt, not create-or-replaced: it's an
-- append-only chain (006 → 014 → 015 → 022 → 024 → 032) and this both adds
-- four columns and stops exposing cancellation_tier (032) — the flat refund
-- rule replaces the per-partner tiers, and 036 removes the column itself once
-- it has rewritten the cancel path that still reads it. Nothing depends on
-- this view — it's a leaf read — so the drop is clean.
-- ---------------------------------------------------------------------------

drop view if exists my_bookings;

create view my_bookings as
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
  partner_maps_url(i.partner_id)      as maps_url,
  partner_address(i.partner_id)       as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


-- partner_bookings: 028's column order kept intact (create-or-replace can
-- only append), the four payment columns tacked on the end.
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


-- Check: seven categories, tables free, and no booking left pending.
select kind, mode from category_payment order by kind;
select count(*) as still_pending from booking_items where state = 'pending';
