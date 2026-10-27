-- ===========================================================================
-- Migration 054 — a dummy "DJ Night" event for the redesigned Events screen
--
-- The Events screen (app/events) got a visual redesign — image-topped cards,
-- matching Activities and Dine. This adds one sample listing so the new look
-- has something on it beyond the six rows already in seed.sql: a resident DJ
-- night at a new venue partner, "Castaway Beach Club".
--
-- Pricing already follows the same rule as every other paid event (034/025):
-- entry is charged in full, online, at booking time — category_payment has
-- 'event' set to 'full' — and Andaman Go's cut is the standard 30% commission
-- (commission_rates, 'event' = 3000 bps), leaving 70% for partner payout.
-- Nothing here changes that policy; this migration only adds a listing.
--
-- Idempotent: re-running it does nothing once the rows exist.
-- Safe to run more than once.
-- ===========================================================================

insert into partners (slug, name, kind, island_slug)
values ('castaway-beach-club', 'Castaway Beach Club', 'venue', 'havelock')
on conflict (slug) do nothing;

insert into events
  (slug, partner_id, island_slug, genre, mark, name, venue, area,
   on_date, time_mins, entry_paise, capacity, rating, reviews, about,
   age_restriction, performer)
select
  'dj-night-castaway', p.id, 'havelock', 'dj', 'DJ', 'DJ Night', 'Castaway Beach Club', 'Beach No. 7',
  (current_date + 3)::date, 1260, 60000, 150, 4.5, 0,
  'A resident DJ spins house and Bollywood remixes right on the sand, fairy lights strung between the palms. Entry includes one welcome drink.',
  'all-ages', 'DJ Nyx'
from partners p
where p.slug = 'castaway-beach-club'
on conflict (slug) do nothing;
