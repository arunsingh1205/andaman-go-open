-- ===========================================================================
-- Migration 006 — one query for the Bookings screen
--
-- A booking item stores a kind and a subject id. Turning that into "Try-dive
-- scuba at Nemo Reef, Blue Coral Divers, Havelock" means reaching into a
-- different table for each kind — which the app should not be doing seven
-- times over a slow island connection. So the join lives here and the screen
-- asks one question.
--
-- Two things in this file are load-bearing, and both are about who can see what.
--
-- 1. security_invoker ON THE VIEW.
--    A view normally runs with its owner's rights, which would hand every
--    traveller everybody else's bookings. This makes it run as whoever is
--    asking, so the row level security on `bookings` still decides.
--
-- 2. THE NAMES ARE LOOKED UP WITH DEFINER RIGHTS.
--    The catalogue hides partners who are not approved — correct for browsing,
--    wrong for history. If the view joined `partners` directly, suspending a
--    dive shop would make every booking anybody ever made with them disappear
--    from their own Bookings screen. A traveller's record of what they paid
--    for is theirs, and it cannot depend on whether the shop is still listed
--    today. So the two name lookups below deliberately see past that filter,
--    and they return a name and nothing else.
--
-- Safe to run more than once.
-- ===========================================================================

-- Redefined from 005 with definer rights, for the reason above.
create or replace function subject_title(p_kind text, p_subject_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'activity' then (select name from activities where id = p_subject_id)
    when 'ferry'    then (select p.name from sailings s join partners p on p.id = s.partner_id
                          where s.id = p_subject_id)
    when 'table'    then (select name from restaurants where id = p_subject_id)
    when 'event'    then (select name from events where id = p_subject_id)
    when 'trip'     then (select title from trips where id = p_subject_id)
    when 'stay'     then (select name from stays where id = p_subject_id)
    when 'rental'   then (select name from partners where id = p_subject_id)
  end
$$;

/** Just the trading name. Nothing else about the partner is exposed. */
create or replace function partner_name(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select name from partners where id = p_partner_id
$$;

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
  i.state,
  i.ticket_code,
  i.redeemed_at
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);

grant select on my_bookings to authenticated, anon;
grant execute on function subject_title(text, uuid) to authenticated, anon;
grant execute on function partner_name(uuid) to authenticated, anon;

-- Check: only the calling account's own bookings, and they survive a partner
-- being suspended.
select ref_code, on_date, kind, title, operator, party, price_paise, state
from my_bookings
order by on_date desc, starts_at;
