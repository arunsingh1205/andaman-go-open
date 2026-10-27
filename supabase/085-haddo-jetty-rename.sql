-- ===========================================================================
-- Migration 085 — Haddo Wharf is actually Haddo Jetty
--
-- 048 seeded this place as "Haddo Wharf", and 084 only added "wharf" and
-- "harbour" as aliases. On the ground it's Haddo Jetty — and per Arun, most
-- of the private ferries actually run from here, not Phoenix Bay — so a
-- traveller searching "Haddo Jetty" (the name they'd actually use) matched
-- nothing: PlacePicker matches by substring, and "haddo jetty" isn't a
-- substring of "Haddo Wharf" or of any of its old aliases.
--
-- Renames the place itself (safe — every reference is by id, not label;
-- cab_places.label is only ever read for display and search) and updates
-- the rate label to match. Old terms stay as aliases so nothing that used
-- to find it stops working.
--
-- Safe to run more than once.
-- ===========================================================================

update cab_places
set label = 'Haddo Jetty',
    aliases = array(select distinct unnest(
      aliases || '{haddo jetty,haddo wharf,private ferry,ferry jetty}'::text[]
    ))
where island_slug = 'port-blair' and label = 'Haddo Wharf';

update cab_rate_card
set label = 'Haddo Jetty transfer'
where island_slug = 'port-blair' and label = 'Haddo Wharf transfer';


select 'haddo jetty renamed' as done,
  (select label from cab_places where island_slug = 'port-blair' and label = 'Haddo Jetty') as place,
  (select label from cab_rate_card where island_slug = 'port-blair' and label = 'Haddo Jetty transfer') as rate;
