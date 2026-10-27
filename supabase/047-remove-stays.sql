-- ===========================================================================
-- Migration 047 — remove Stays
--
-- Hotels / homestays / resorts are a market Andaman Go can't compete in — other
-- platforms own it — so the whole category comes out: the `stays` table, the
-- 'stay' branch of every kind-dispatch function, and the 'stay' value from
-- every `kind in (...)` CHECK. Migration 048 puts a "Cab / car" service in the
-- same slot; the shared kind-dispatch functions are re-established there (and
-- in 049) with a 'cab' branch instead.
--
-- `stays` was one flat table — no child tables — so this is mostly deletes and
-- one dropped `create_booking` branch.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Data. Anything keyed to a stay goes first, so the CHECK tightening and
--    the table drop don't trip over live rows. Dev data only — there is no
--    real stay booking anywhere.
-- ---------------------------------------------------------------------------

delete from booking_items  where kind = 'stay';
delete from listing_photos where listing_kind = 'stay';
delete from reviews        where kind = 'stay';
delete from listing_views  where kind = 'stay';
delete from listing_closures where kind = 'stay';

delete from commission_rates where kind = 'stay';
delete from category_payment  where kind = 'stay';

-- Deleting a stay operator cascades to its `stays`, `partner_users`, payout
-- account, etc. (all FK ... on delete cascade).
delete from partners where kind = 'stay';

-- Availability LAST: the sync_availability trigger fires once per deleted
-- booking_item and re-inserts an `availability` row (kind = 'stay', taken 0)
-- for each, so this has to come after the booking_items delete above — clearing
-- it first would just leave the trigger's rows behind for step 4 to choke on.
delete from availability where kind = 'stay';


-- ---------------------------------------------------------------------------
-- 2. The stay-only write RPCs.
-- ---------------------------------------------------------------------------

drop function if exists add_partner_stay(text, text, text, int, text, text, text[], text);
drop function if exists add_partner_stay_impl(text, text, text, int, text, text, text[], text);
drop function if exists update_partner_stay(uuid, text, text, int, text, text, text[], text);
drop function if exists update_partner_stay_impl(uuid, text, text, int, text, text, text[], text);


-- ---------------------------------------------------------------------------
-- 3. The table.
-- ---------------------------------------------------------------------------

drop table if exists stays cascade;


-- ---------------------------------------------------------------------------
-- 4. Every CHECK that lists 'stay' is rewritten to the post-047 world: no
--    'stay', and 'cab' allowed (the cab tables land in 048, but a CHECK value
--    list can name a kind before its table exists). Migration 048 re-asserts
--    the same lists, so the two never drift.
-- ---------------------------------------------------------------------------

alter table partners drop constraint if exists partners_kind_check;
alter table partners add constraint partners_kind_check
  check (kind in ('dive','ferry','restaurant','rental','venue','host','cab'));

alter table booking_items drop constraint if exists booking_items_kind_check;
alter table booking_items add constraint booking_items_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab'));

alter table availability drop constraint if exists availability_kind_check;
alter table availability add constraint availability_kind_check
  check (kind in ('activity','ferry','table','event','rental','trip','cab'));

alter table reviews drop constraint if exists reviews_kind_check;
alter table reviews add constraint reviews_kind_check
  check (kind in ('activity','table','event','trip','rental','cab'));

alter table listing_views drop constraint if exists listing_views_kind_check;
alter table listing_views add constraint listing_views_kind_check
  check (kind in ('activity','table','event','trip','rental','cab'));

alter table listing_photos drop constraint if exists listing_photos_listing_kind_check;
alter table listing_photos add constraint listing_photos_listing_kind_check
  check (listing_kind in ('activity','rental','table','event','trip','ferry','cab'));

alter table commission_rates drop constraint if exists commission_rates_kind_check;
alter table commission_rates add constraint commission_rates_kind_check
  check (kind in ('activity','ferry','table','event','trip','rental','cab'));

alter table category_payment drop constraint if exists category_payment_kind_check;
alter table category_payment add constraint category_payment_kind_check
  check (kind in ('activity','ferry','table','event','trip','rental','cab'));


-- ---------------------------------------------------------------------------
-- 5. create_booking — body carried over verbatim from 042, with the
--    `when 'stay'` branch removed. No signature change. Cabs do NOT go through
--    here — they have their own create_cab_booking (049).
-- ---------------------------------------------------------------------------

create or replace function create_booking(
  p_kind      text,
  p_subject   text,
  p_starts_at timestamptz,
  p_party     int  default 1,
  p_units     int  default 1,
  p_variant   text default null,
  p_extras    boolean default false,
  p_pay_mode  text default 'full'
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


-- Check: no 'stay' left anywhere it was.
select
  (select count(*) from information_schema.tables where table_name = 'stays') as stays_table,
  (select count(*) from booking_items where kind = 'stay') as stay_items,
  (select count(*) from commission_rates where kind = 'stay') as stay_rates;
