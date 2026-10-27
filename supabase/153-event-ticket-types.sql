-- ===========================================================================
-- Migration 153 — events can sell more than one kind of ticket
--
-- Until now an event had a single entry_paise, charged per head. Real events
-- (District, BookMyShow) sell passes: Single, Couple, Group of 5, Family of
-- 10, Stag, and so on — each with its own price and a fixed number of people
-- it lets in.
--
-- event_tickets holds those passes. events.entry_paise stays as the "from"
-- price (the cheapest pass, kept in sync by set_event_tickets) so the list,
-- sorting and every report that already reads it keep working. An event with
-- no event_tickets rows behaves exactly as before.
--
-- Booking a pass: create_booking's existing p_variant carries the ticket id
-- and p_units the number of passes. Price = pass price × passes; seats taken
-- = people-per-pass × passes (stored as party, which is what availability
-- counts). The pass name is stamped on booking_items.ticket_label so it
-- survives later edits to the event's tickets.
--
-- create_booking is rebuilt on top of 150's body — same 11-arg signature, so
-- CREATE OR REPLACE is safe. save_event_guests learns that a pass covers a
-- fixed headcount, so every person on it (kids included) is a guest and the
-- "kids 3 and under are free" rule only applies to events with no passes.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists event_tickets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  description text not null default '',
  price_paise int  not null check (price_paise >= 0),
  people      int  not null default 1 check (people between 1 and 50),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists event_tickets_event_idx on event_tickets (event_id, sort_order);

alter table event_tickets enable row level security;

drop policy if exists event_tickets_read on event_tickets;
create policy event_tickets_read on event_tickets for select
  using (true);

alter table booking_items add column if not exists ticket_label text;

-- Replaces the whole ticket list of one event. Owner of the listing, or an
-- admin. Also pins events.entry_paise to the cheapest pass.
create or replace function set_event_tickets(p_event_id uuid, p_tickets jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid;
  v_partner uuid;
  t         jsonb;
  v_n       int;
  v_min     int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_owner := listing_partner_id('event', p_event_id);
  if v_owner is null then
    return query select false, 'That event no longer exists.'::text;
    return;
  end if;

  if not is_admin() then
    perform assert_partner_owner();
    select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
    if v_partner is null or v_partner <> v_owner then
      return query select false, 'That event no longer exists.'::text;
      return;
    end if;
  end if;

  if p_tickets is null or jsonb_typeof(p_tickets) <> 'array' then
    return query select false, 'Tickets must be a list.'::text;
    return;
  end if;

  v_n := jsonb_array_length(p_tickets);
  if v_n > 10 then
    return query select false, 'An event can have at most 10 ticket types.'::text;
    return;
  end if;

  for t in select * from jsonb_array_elements(p_tickets) loop
    if coalesce(trim(t->>'name'), '') = '' or length(trim(t->>'name')) > 60 then
      return query select false, 'Every ticket needs a name (up to 60 characters).'::text;
      return;
    end if;
    if (t->>'pricePaise') is null or (t->>'pricePaise')::int < 0 then
      return query select false, 'Every ticket needs a price of ₹0 or more.'::text;
      return;
    end if;
    if (t->>'people') is null or (t->>'people')::int not between 1 and 50 then
      return query select false, 'Every ticket must admit between 1 and 50 people.'::text;
      return;
    end if;
  end loop;

  delete from event_tickets where event_id = p_event_id;

  insert into event_tickets (event_id, name, description, price_paise, people, sort_order)
  select p_event_id,
         trim(x.t->>'name'),
         coalesce(trim(x.t->>'description'), ''),
         (x.t->>'pricePaise')::int,
         (x.t->>'people')::int,
         x.ord - 1
  from jsonb_array_elements(p_tickets) with ordinality as x(t, ord);

  select min(price_paise) into v_min from event_tickets where event_id = p_event_id;
  if v_min is not null then
    update events set entry_paise = v_min where id = p_event_id;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_event_tickets(uuid, jsonb) from public;
grant execute on function set_event_tickets(uuid, jsonb) to authenticated;

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
  p_delivery_hotel text default null
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
      where e.slug = p_subject and e.is_listed and e.on_date = v_day;

      -- An event with passes is booked by pass: p_variant is the pass id,
      -- p_units how many of them. The price and the seats it takes come from
      -- the pass row here, never from the client.
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
     pickup_address, ticket_label)
  values
    (v_booking, p_kind, v_subject_id, v_variant_id, v_partner_id, p_starts_at,
     v_party, p_units, v_price, v_delivery, p_pay_mode, v_paid, v_balance,
     v_state, v_ticket, now(), p_razorpay_order_id, p_razorpay_payment_id,
     case when p_kind = 'rental' and p_extras then trim(p_delivery_hotel) else null end,
     v_ticket_lbl);

  return query select v_ref, v_ticket, v_price, v_state, v_paid, v_balance;
end $$;

create or replace function save_event_guests(p_ref_code text, p_guests jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_item     uuid;
  v_party    int;
  v_label    text;
  v_ticketed int;
  g          jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party, i.ticket_label into v_item, v_party, v_label
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'event'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That event booking could not be found.'::text;
    return;
  end if;

  if p_guests is null or jsonb_typeof(p_guests) <> 'array' or jsonb_array_length(p_guests) < 1 then
    return query select false, 'Add everyone who is coming.'::text;
    return;
  end if;

  v_ticketed := 0;
  for g in select * from jsonb_array_elements(p_guests) loop
    if coalesce(trim(g->>'fullName'), '') = '' then
      return query select false, 'Every guest needs a name.'::text;
      return;
    end if;
    if (g->>'age') is null or (g->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every guest.'::text;
      return;
    end if;
    if v_label is not null or (g->>'age')::int > 3 then
      v_ticketed := v_ticketed + 1;
    end if;
  end loop;

  if v_ticketed <> v_party then
    return query select false,
      case when v_label is not null
        then format('Your %s ticket admits %s %s — add exactly that many names.',
                    v_label, v_party, case when v_party = 1 then 'person' else 'people' end)
        else format('%s of your guests need a ticket, but %s %s booked. Kids 3 and under don''t need one.',
                    v_ticketed, v_party, case when v_party = 1 then 'was' else 'were' end)
      end::text;
    return;
  end if;

  delete from event_guests where booking_item_id = v_item;

  insert into event_guests (booking_item_id, full_name, age)
  select v_item, trim(att->>'fullName'), (att->>'age')::int
  from jsonb_array_elements(p_guests) as att;

  return query select true, 'Saved.'::text;
end $$;

select 'events can now sell multiple ticket types (passes)' as done;
