-- ===========================================================================
-- Migration 041 — the islands are officially renamed
--
--   Port Blair  ->  Sri Vijaya Puram
--   Havelock    ->  Swaraj Dweep
--   Neil        ->  Shaheed Dweep
--
-- `islands.official_name` has always carried these; `islands.name` — the string
-- the app actually shows — now catches up. Every server-side label follows
-- automatically: my_bookings.island_name, the ferry route in subject_title
-- (040), the island tag on rentals and trips.
--
-- The familiar names don't disappear from the app. The picker keeps them in
-- parentheses — "Swaraj Dweep (Havelock)" — because that's still what
-- travellers say and search for (see lib/islands.ts).
--
-- Safe to run more than once.
-- ===========================================================================

update islands set name = official_name
where slug in ('port-blair', 'havelock', 'neil')
  and name <> official_name;

-- Check: name and the government name now agree everywhere.
select slug, name, official_name from islands order by sort_order;
