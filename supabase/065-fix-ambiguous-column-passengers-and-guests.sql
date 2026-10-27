-- Fix "column reference is ambiguous" in save_ferry_passengers and
-- save_event_guests (2026-09-07).
--
-- Both functions declare a loop variable (`p`, `g`) and then, further down,
-- reuse that same name as the row alias in the insert's final
-- `... from jsonb_array_elements(...) as p` / `as g`. Postgres can't tell
-- the loop variable and the row alias apart inside that select list, so
-- every real ferry booking or event RSVP's second write — recording who is
-- travelling / coming — failed with 42702 right after the seat and payment
-- already went through. save_trip_travellers (056) already used a distinct
-- alias (`elem`) and needs no change. Renaming the insert aliases to `pax` /
-- `att` removes the ambiguity; loop variables, validation and inserts are
-- otherwise unchanged.

create or replace function save_ferry_passengers(p_ref_code text, p_passengers jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_item   uuid;
  v_party  int;
  p        jsonb;
  v_nat    text;
  v_idtype text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party into v_item, v_party
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'ferry'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That ferry booking could not be found.'::text;
    return;
  end if;

  if p_passengers is null or jsonb_typeof(p_passengers) <> 'array'
     or jsonb_array_length(p_passengers) <> v_party then
    return query select false, format('Enter details for all %s passengers.', v_party)::text;
    return;
  end if;

  for p in select * from jsonb_array_elements(p_passengers) loop
    v_nat    := coalesce(nullif(trim(p->>'nationality'), ''), 'Indian');
    v_idtype := lower(coalesce(p->>'idType', ''));

    if coalesce(trim(p->>'fullName'), '') = '' then
      return query select false, 'Every passenger needs a full name.'::text;
      return;
    end if;
    if (p->>'age') is null or (p->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every passenger.'::text;
      return;
    end if;
    if lower(coalesce(p->>'gender', '')) not in ('male','female','other') then
      return query select false, 'Choose a gender for every passenger.'::text;
      return;
    end if;
    if v_idtype not in ('aadhaar','passport','driving-licence') then
      return query select false, 'Choose an ID type for every passenger.'::text;
      return;
    end if;
    if v_nat <> 'Indian' and v_idtype <> 'passport' then
      return query select false, 'A foreign national must travel on a passport.'::text;
      return;
    end if;
    if coalesce(trim(p->>'idNumber'), '') = '' then
      return query select false, 'Enter the ID number for every passenger.'::text;
      return;
    end if;
  end loop;

  delete from ferry_passengers where booking_item_id = v_item;

  insert into ferry_passengers (booking_item_id, full_name, age, gender, nationality, id_type, id_number)
  select
    v_item,
    trim(pax->>'fullName'),
    (pax->>'age')::int,
    lower(pax->>'gender'),
    coalesce(nullif(trim(pax->>'nationality'), ''), 'Indian'),
    lower(pax->>'idType'),
    trim(pax->>'idNumber')
  from jsonb_array_elements(p_passengers) as pax;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_ferry_passengers(text, jsonb) from public;
grant execute on function save_ferry_passengers(text, jsonb) to authenticated;

create or replace function save_event_guests(p_ref_code text, p_guests jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_item     uuid;
  v_party    int;
  v_ticketed int;
  g          jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party into v_item, v_party
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
    if (g->>'age')::int > 3 then
      v_ticketed := v_ticketed + 1;
    end if;
  end loop;

  if v_ticketed <> v_party then
    return query select false,
      format('%s of your guests need a ticket, but %s %s booked. Kids 3 and under don''t need one.',
             v_ticketed, v_party, case when v_party = 1 then 'was' else 'were' end)::text;
    return;
  end if;

  delete from event_guests where booking_item_id = v_item;

  insert into event_guests (booking_item_id, full_name, age)
  select v_item, trim(att->>'fullName'), (att->>'age')::int
  from jsonb_array_elements(p_guests) as att;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_event_guests(text, jsonb) from public;
grant execute on function save_event_guests(text, jsonb) to authenticated;

select 'ambiguous column reference fixed for ferry passengers and event guests' as done;
