-- ===========================================================================
-- Migration 002 — a partner's credential
--
-- The app shows "Blue Coral Divers · PADI", but schema.sql only had room for
-- the name, so the swap would have quietly dropped the PADI. A certification
-- belongs to the business, not to one listing, so it goes on partners.
--
-- This is what a migration looks like: a small file that changes an existing
-- database rather than rebuilding it. Run it in the SQL editor. Keep it in
-- supabase/ next to the others — the numbered order is how you or anyone else
-- rebuilds this database from nothing later.
-- ===========================================================================

alter table partners add column if not exists credential text;

update partners set credential = 'PADI' where slug = 'blue-coral-divers';

-- Check: the dive operators, with the one that has a certification.
select slug, name, credential from partners where kind = 'dive' order by slug;
