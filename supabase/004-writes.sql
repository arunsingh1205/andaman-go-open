-- ===========================================================================
-- Migration 004 — making a booking
--
-- Everything so far has been read-only. This is the write layer, and it is all
-- in the database on purpose. Three reasons:
--
-- 1. THE PRICE IS NEVER SENT FROM THE BROWSER. The function below looks the
--    price up itself. Anything a phone tells us about money is a suggestion,
--    not a fact, and a booking API that accepts a price is a booking API that
--    sells scuba dives for one rupee.
--
-- 2. THE SEAT CHECK AND THE BOOKING HAPPEN TOGETHER. Two people tapping the
--    last seat at the same moment is not a rare case on a small island with
--    four dive boats. The row is locked, checked, and written in one step, so
--    the second tap loses cleanly instead of overselling.
--
-- 3. THERE IS ONE WAY IN. Nothing has permission to insert a booking directly.
--    The only door is create_booking(), which means the rules cannot be
--    skipped by a bug in a screen written six months from now.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Seeded demand vs real bookings.
--
-- availability.taken currently holds pretend bookings from the seed — the
-- numbers that make "2 seats left" show up before anybody has booked anything.
-- Once the trigger below starts recomputing from real bookings, those would be
-- wiped. So they move into `baseline`, and taken becomes baseline + real.
--
-- baseline is honest about what it is: demand we know about but did not record
-- as bookings. When real partners are on the system it goes to zero.
-- ---------------------------------------------------------------------------

alter table availability add column if not exists baseline int not null default 0;

update availability set baseline = taken where baseline = 0 and taken > 0;


-- ---------------------------------------------------------------------------
-- Keeping the counts honest.
--
-- Rather than adding and subtracting, this recounts the affected slot from
-- scratch every time. Slower, and it does not matter at all at this size —
-- what it buys is that the count cannot drift. An increment that runs twice
-- is wrong forever; a recount is right again on the next booking.
--
-- Only states that actually hold a place are counted. A refunded booking gives
-- the seat back without anybody having to remember to give it back.
-- ---------------------------------------------------------------------------

create or replace function sync_availability() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind       text;
  v_subject_id uuid;
  v_starts_at  timestamptz;
  v_total      int;
begin
  v_kind       := coalesce(new.kind, old.kind);
  v_subject_id := coalesce(new.subject_id, old.subject_id);
  v_starts_at  := coalesce(new.starts_at, old.starts_at);

  select coalesce(sum(party), 0) into v_total
  from booking_items
  where kind = v_kind
    and subject_id = v_subject_id
    and starts_at = v_starts_at
    and state in ('pending', 'confirmed', 'disrupted', 'completed');

  insert into availability (kind, subject_id, starts_at, baseline, taken)
  values (v_kind, v_subject_id, v_starts_at, 0, v_total)
  on conflict (kind, subject_id, starts_at)
  do update set taken = availability.baseline + v_total;

  return null;
end $$;

drop trigger if exists booking_items_sync_availability on booking_items;

create trigger booking_items_sync_availability
after insert or update or delete on booking_items
for each row execute function sync_availability();


-- ---------------------------------------------------------------------------
-- Reference codes.
--
-- No O, 0, I or 1 — these get read down a phone line to a boat operator who is
-- standing on a jetty, and "AG-B0OK1" is a support call waiting to happen.
-- ---------------------------------------------------------------------------

create or replace function new_ref_code() returns text
language plpgsql as $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'AG-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where ref_code = candidate);
  end loop;
  return candidate;
end $$;


-- ---------------------------------------------------------------------------
-- create_booking — the only way anything gets booked.
--
--   p_kind      what sort of thing: activity, ferry, table, event, trip,
--               rental, stay
--   p_subject   its slug, or its code for ferries
--   p_starts_at when it starts
--   p_party     people, or seats. For a restaurant this is the party size; the
--               thing being held is one table.
--   p_units     days for a rental, nights for a stay, 1 for everything else
--   p_variant   which vehicle, for a rental
--   p_extras    hotel delivery, for a rental
--
-- Returns the day's reference, this item's ticket, and what it costs.
--
-- Bookings are grouped by day. Book a ferry and then a dive on the same date
-- and you get one reference covering both — which is what makes "if the
-- weather takes one thing it takes the lot" something the data can actually
-- support, rather than a sentence on a screen.
-- ---------------------------------------------------------------------------

create or replace function create_booking(
  p_kind      text,
  p_subject   text,
  p_starts_at timestamptz,
  p_party     int  default 1,
  p_units     int  default 1,
  p_variant   text default null,
  p_extras    boolean default false
)
returns table (ref_code text, ticket_code text, price_paise int, state text)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_subject_id uuid;
  v_partner_id uuid;
  v_island     text;
  v_price      int;
  v_capacity   int;
  v_taken      int;
  v_needed     int := p_party;
  v_state      text;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
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

  -- Look the thing up, and work out its price and its capacity. Note that
  -- every price below comes out of the catalogue, never out of the request.
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
      -- The island of a crossing is where it lands you. A day that starts on
      -- the 6:20 out of Port Blair is a Havelock day.
      select s.id, s.partner_id, s.to_island, s.fare_paise * p_party, s.capacity
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
      from sailings s
      where s.code = p_subject and s.is_listed and s.dep_mins = v_time_mins;

    when 'table' then
      -- A restaurant holds one table, whatever the size of the party.
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
      -- Priced per day, plus delivery. Stock is not modelled yet, so there is
      -- no capacity check — the shop confirming is what holds the vehicle.
      select p.id, p.id, p.island_slug,
             v.rate_paise * p_units + case when p_extras then 10000 else 0 end,
             null
        into v_subject_id, v_partner_id, v_island, v_price, v_capacity
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

  -- Lock this slot's count before reading it, so two people tapping the last
  -- seat at the same moment cannot both be told yes.
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

  -- Some things a person has to accept before they are real. A dive operator,
  -- a local host and a rental shop all get to say no; a ferry seat, a free
  -- table, a ticketed event and a room do not need anybody's permission.
  v_state := case when p_kind in ('activity', 'trip', 'rental') then 'pending' else 'confirmed' end;

  -- One booking per day. A second thing booked for the same date joins the
  -- booking that is already there — including the crossing that got you
  -- there, which is the whole point. Grouping by island as well as date would
  -- split the ferry off from the dive it exists to deliver you to.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings
  where user_id = v_user and on_date = v_day
  limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    insert into bookings (ref_code, user_id, island_slug, on_date)
    values (v_ref, v_user, v_island, v_day)
    returning id into v_booking;
  end if;

  v_ticket := case
    when v_state = 'confirmed'
    then v_ref || '-' || upper(left(p_kind, 1))
    else null
  end;

  insert into booking_items
    (booking_id, kind, subject_id, partner_id, starts_at, party, price_paise, state, ticket_code)
  values
    (v_booking, p_kind, v_subject_id, v_partner_id, p_starts_at, p_party, v_price, v_state, v_ticket);

  return query select v_ref, v_ticket, v_price, v_state;
end $$;

-- Signed-in visitors may call it. They still cannot touch the tables directly:
-- nothing grants insert on bookings or booking_items to anybody.
revoke all on function create_booking(text, text, timestamptz, int, int, text, boolean) from public;
grant execute on function create_booking(text, text, timestamptz, int, int, text, boolean)
  to authenticated, anon;


-- ---------------------------------------------------------------------------
-- Cancelling. Same reasoning: one door, and the seat comes back on its own
-- because the trigger recounts.
-- ---------------------------------------------------------------------------

create or replace function refund_booking(p_ref_code text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update booking_items i
  set state = 'refunded'
  from bookings b
  where b.id = i.booking_id
    and b.ref_code = p_ref_code
    and b.user_id = v_user
    and i.state in ('pending', 'confirmed', 'disrupted');

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function refund_booking(text) from public;
grant execute on function refund_booking(text) to authenticated, anon;
