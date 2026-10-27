-- ===========================================================================
-- Migration 040 — the rest of the ferry network
--
-- The schema has always had `from_island` / `to_island` on `sailings` and a
-- route index, and a partner can file a sailing on any pair of islands. But the
-- seed only ever had four sailings, all Port Blair -> Havelock, and the
-- traveller search hardcoded that one route with a swap toggle. Anyone wanting
-- Neil -> Havelock, or a boat back the other way, had nowhere to tap.
--
-- This migration:
--   1. Redefines subject_title() so a ferry booking reads as its route
--      ("Neil -> Havelock") instead of the operator's own name repeated. Every
--      other kind is unchanged.
--   2. Seeds the rest of the Port Blair / Havelock / Neil triangle — both
--      directions, two or three of Makruzz / Green Ocean / Nautika per leg, at
--      plausible times and fares. Idempotent on `code`.
--   3. Puts a few of tomorrow's new crossings under pressure so "Only N seats
--      left" has something to say on the other routes too.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. A ferry booking's title is its route.
--
-- Redefined from 006 (which returned the partner name, same as `operator`).
-- Still SECURITY DEFINER for the reason 006 spells out — a booking's own
-- history can't depend on whether the operator is still listed today.
-- ---------------------------------------------------------------------------

create or replace function subject_title(p_kind text, p_subject_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'activity' then (select name from activities where id = p_subject_id)
    when 'ferry'    then (select fi.name || ' → ' || ti.name
                          from sailings s
                          join islands fi on fi.slug = s.from_island
                          join islands ti on ti.slug = s.to_island
                          where s.id = p_subject_id)
    when 'table'    then (select name from restaurants where id = p_subject_id)
    when 'event'    then (select name from events where id = p_subject_id)
    when 'trip'     then (select title from trips where id = p_subject_id)
    when 'stay'     then (select name from stays where id = p_subject_id)
    when 'rental'   then (select name from partners where id = p_subject_id)
  end
$$;


-- ---------------------------------------------------------------------------
-- 2. The rest of the triangle.
--
-- dep_mins is minutes past midnight IST. style_label / style_tone / info match
-- how 003 set them for each operator's Port Blair -> Havelock sailing.
-- ---------------------------------------------------------------------------

insert into sailings
  (code, partner_id, from_island, to_island, style_label, style_tone,
   dep_mins, duration_mins, fare_paise, capacity, info, info_warn)
select v.code, p.id, v.from_island, v.to_island, v.style_label, v.style_tone,
       v.dep_mins, v.duration_mins, v.fare_paise, v.capacity, v.info, v.info_warn
from (values
  -- Port Blair -> Neil
  ('mak-pb-nl', 'makruzz',       'port-blair', 'neil',       'Deluxe',  'plain',  390, 130, 145000, 200, 'Window seats available', false),
  ('grn-pb-nl', 'green-ocean-2', 'port-blair', 'neil',       'Popular', 'warm',   540, 145, 118000, 200, '',                      false),
  -- Havelock -> Neil
  ('mak-hv-nl', 'makruzz',       'havelock',   'neil',       'Deluxe',  'plain',  630,  60,  95000, 200, '',                      false),
  ('nau-hv-nl', 'nautika',       'havelock',   'neil',       'Premium', 'plain',  960,  55, 110000, 180, 'Sea gets choppy after 2 PM', true),
  -- Neil -> Havelock
  ('mak-nl-hv', 'makruzz',       'neil',       'havelock',   'Deluxe',  'plain',  540,  60,  95000, 200, '',                      false),
  ('grn-nl-hv', 'green-ocean-2', 'neil',       'havelock',   'Popular', 'warm',   780,  75,  88000, 200, '',                      false),
  -- Neil -> Port Blair
  ('mak-nl-pb', 'makruzz',       'neil',       'port-blair', 'Deluxe',  'plain',  705, 130, 145000, 200, '',                      false),
  ('grn-nl-pb', 'green-ocean-2', 'neil',       'port-blair', 'Popular', 'warm',   915, 150, 118000, 200, '',                      false),
  ('nau-nl-pb', 'nautika',       'neil',       'port-blair', 'Premium', 'plain', 1035, 110, 165000, 180, '',                      false),
  -- Havelock -> Port Blair
  ('grn-hv-pb', 'green-ocean-2', 'havelock',   'port-blair', 'Popular', 'warm',   720, 105, 130000, 200, '',                      false),
  ('mak-hv-pb', 'makruzz',       'havelock',   'port-blair', 'Deluxe',  'plain',  960,  90, 165000, 200, 'Window seats available', false),
  ('nau-hv-pb', 'nautika',       'havelock',   'port-blair', 'Premium', 'plain', 1050,  85, 175000, 180, '',                      false)
) as v(code, partner_slug, from_island, to_island, style_label, style_tone,
       dep_mins, duration_mins, fare_paise, capacity, info, info_warn)
join partners p on p.slug = v.partner_slug
on conflict (code) do nothing;


-- ---------------------------------------------------------------------------
-- 3. Seats already gone on a few of tomorrow's new crossings.
-- ---------------------------------------------------------------------------

insert into availability (kind, subject_id, starts_at, taken)
select 'ferry',
       s.id,
       ((current_date + 1) + make_interval(mins => s.dep_mins)) at time zone 'Asia/Kolkata',
       v.taken
from sailings s
join (values
  ('grn-pb-nl', 172),
  ('nau-hv-nl', 173),
  ('grn-hv-pb', 190),
  ('mak-nl-pb',  64)
) as v(code, taken) on v.code = s.code
on conflict (kind, subject_id, starts_at) do update set taken = excluded.taken;


-- Check: every route the search can now offer, cheapest first per route.
select s.from_island || ' → ' || s.to_island as route,
       p.name as operator, s.style_label, s.fare_paise,
       s.capacity - coalesce(a.taken, 0) as seats_left_tomorrow
from sailings s
join partners p on p.id = s.partner_id
left join availability a
  on a.kind = 'ferry' and a.subject_id = s.id
 and a.starts_at = ((current_date + 1) + make_interval(mins => s.dep_mins)) at time zone 'Asia/Kolkata'
where s.is_listed
order by route, s.fare_paise;
