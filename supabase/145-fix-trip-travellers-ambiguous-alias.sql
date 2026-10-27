-- ===========================================================================
-- Migration 145 — save_trip_travellers regressed the exact bug 065 fixed
--
-- 065 fixed save_ferry_passengers and save_event_guests for this precise
-- shape: a DECLARE'd loop variable reused as the FROM-clause row alias in
-- the final INSERT...SELECT, which Postgres can't tell apart from the
-- variable of the same name and rejects with "column reference is
-- ambiguous" (42702). 065's own header noted save_trip_travellers (056)
-- "already used a distinct alias (elem) and needs no change."
--
-- 076 (trip hotel pickup, 2026-09-11) dropped and recreated
-- save_trip_travellers to add p_hotel_address — and in doing so silently
-- reintroduced the collision: `declare t jsonb;` is used both as the
-- validation loop's variable (`for t in select * from
-- jsonb_array_elements(p_travellers) loop`) and, unrelatedly, as the row
-- alias in the final insert (`... from jsonb_array_elements(p_travellers)
-- as t`). Every real trip booking's second write has been failing with
-- 42702 since 076 went live — the seat and payment go through
-- (create_booking, unaffected), only this follow-up call fails, landing the
-- traveller on lib/book.ts's bookTrip fallback message: "Your seat is
-- held, but the traveller details didn't save. Open My bookings to add
-- them." Found by an audit agent cross-checking every booking-kind RPC
-- against this exact bug class after three similar bugs turned up in the
-- cab flow earlier today.
--
-- Fix: the final insert's row alias is renamed to `elem`, matching the
-- convention 065 already established elsewhere (pax/att) and what 056
-- originally had here before 076 regressed it. The validation loop keeps
-- using `t` — that's fine on its own, nothing else in the function
-- competes with it there.
--
-- Also re-runs 076's three `add column if not exists` statements —
-- today's contact_name incident (088 claimed to add a column that turned
-- out to never exist live) means a migration whose own function has been
-- silently erroring since it shipped can't be trusted to have applied
-- cleanly in every part, even via `if not exists`. Idempotent either way.
--
-- Safe to run more than once.
-- ===========================================================================

alter table trips
  add column if not exists meet_at_hotel boolean not null default false;

alter table trips
  add column if not exists maps_url text;

alter table booking_items
  add column if not exists pickup_address text;

create or replace function save_trip_travellers(p_ref_code text, p_travellers jsonb, p_hotel_address text default null)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_item    uuid;
  v_party   int;
  v_subject uuid;
  v_hotel   boolean;
  t         jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.id, i.party, i.subject_id into v_item, v_party, v_subject
  from booking_items i
  join bookings b on b.id = i.booking_id
  where b.ref_code = p_ref_code
    and b.user_id = auth.uid()
    and i.kind = 'trip'
  order by i.created_at desc
  limit 1;

  if v_item is null then
    return query select false, 'That trip booking could not be found.'::text;
    return;
  end if;

  if p_travellers is null or jsonb_typeof(p_travellers) <> 'array'
     or jsonb_array_length(p_travellers) <> v_party then
    return query select false, format('Enter details for all %s travellers.', v_party)::text;
    return;
  end if;

  for t in select * from jsonb_array_elements(p_travellers) loop
    if coalesce(trim(t->>'fullName'), '') = '' then
      return query select false, 'Every traveller needs a name.'::text;
      return;
    end if;
    if (t->>'age') is null or (t->>'age')::int not between 0 and 120 then
      return query select false, 'Enter a valid age for every traveller.'::text;
      return;
    end if;
  end loop;

  select meet_at_hotel into v_hotel from trips where id = v_subject;
  if coalesce(v_hotel, false) and coalesce(trim(p_hotel_address), '') = '' then
    return query select false, 'Tell the host where you''re staying so they can pick you up.'::text;
    return;
  end if;

  delete from trip_travellers where booking_item_id = v_item;

  -- Fixed: `elem`, not `t` — see the migration header for what reusing the
  -- loop variable's name as this row alias did.
  insert into trip_travellers (booking_item_id, full_name, age)
  select v_item, trim(elem->>'fullName'), (elem->>'age')::int
  from jsonb_array_elements(p_travellers) as elem;

  update booking_items set pickup_address = nullif(trim(p_hotel_address), '') where id = v_item;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function save_trip_travellers(text, jsonb, text) from public;
grant execute on function save_trip_travellers(text, jsonb, text) to authenticated;

select 'save_trip_travellers: ambiguous alias fixed' as done;
