-- ===========================================================================
-- Migration 144 — bookings.contact_name never actually existed live
--
-- Migration 088 (`alter table bookings add column if not exists contact_name
-- text;`) is in this repo's history and create_ratecard_cab_booking has
-- written to that column ever since — but the live database never had it:
-- the very next "Book a ride" attempt after 143's fare_paise fix failed with
-- `column "contact_name" of relation "bookings" does not exist`, at the
-- insert/update inside create_ratecard_cab_booking that names it. Whatever
-- happened historically (088 not applied, or applied against a different
-- database than the one currently live), the column simply isn't there now.
--
-- This just adds it — if 088 in fact did run at some point, `if not exists`
-- makes this a no-op. admin_bookings/partner_bookings (also from 088)
-- already select b.contact_name; once this column exists those views work
-- as originally intended too, without needing to be redefined here.
--
-- Worth a look separately: if 088 silently never took, other migrations
-- between it and here may also be missing live. Not chased down as part of
-- this fix — flagging it so it doesn't get lost.
--
-- Safe to run more than once.
-- ===========================================================================

alter table bookings add column if not exists contact_name text;

select 'bookings.contact_name added' as done;
