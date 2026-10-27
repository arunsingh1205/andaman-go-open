-- ===========================================================================
-- Migration 055 — bring the seeded events back into the 14-day window
--
-- The six events seed.sql writes (034...) were inserted with dates relative
-- to current_date at the time they were seeded. Days have passed since, so
-- getEvents()'s "next 14 days" window (lib/events.ts) now excludes all of
-- them — the Events screen goes empty even though the rows are still there.
-- This nudges their on_date back to the same relative-to-today pattern the
-- seed always intended, and backfills age_restriction / performer (053) on
-- the rows that predate those columns, plus the performer on the DJ Night
-- dummy event added before that column existed.
--
-- Re-running this later just refreshes the dates again — safe to run more
-- than once, same as re-running seed.sql is safe for local dev.
-- ===========================================================================

update events set on_date = (current_date)::date, age_restriction = '18+', performer = 'DJ Resin'
  where slug = 'beach-dj-sunset-point';
update events set on_date = (current_date)::date, age_restriction = 'all-ages', performer = 'Roots Collective'
  where slug = 'reggae-night-blue-lagoon';
update events set on_date = (current_date)::date, age_restriction = 'all-ages'
  where slug = 'bonfire-drum-circle';
update events set on_date = (current_date + 1)::date, age_restriction = 'all-ages'
  where slug = 'karaoke-night-anchor';
update events set on_date = (current_date + 1)::date, age_restriction = 'all-ages', performer = 'The Anju Duo'
  where slug = 'live-acoustic-anju';
update events set on_date = (current_date + 2)::date, age_restriction = '18+', performer = 'DJ Kade, DJ Row & DJ Ilsa'
  where slug = 'full-moon-party-radhanagar';
update events set performer = 'DJ Nyx'
  where slug = 'dj-night-castaway' and performer is null;

select slug, on_date, age_restriction, performer from events order by on_date;
