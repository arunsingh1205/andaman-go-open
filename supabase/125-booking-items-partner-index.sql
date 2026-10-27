-- ===========================================================================
-- Migration 125 — index booking_items on partner_id
--
-- booking_items has no index on partner_id, despite it being the column
-- Postgres has to filter on for essentially every read of this table:
--   - the "partner sees own items"/"own booking items" RLS policies both
--     qualify on partner_id (BASELINE-2026-09-06-full-schema.sql), so it's
--     evaluated on every row-level check, not just explicit WHERE clauses
--   - lib/partner-bookings.ts and lib/admin-bookings.ts both query this
--     table filtered by partner_id directly
--
-- There's an FK to partners(id) (BASELINE line 7148), but Postgres never
-- auto-indexes foreign keys — so every one of those reads has been doing a
-- sequential scan, and it only gets slower as bookings accumulate.
--
-- Paired with starts_at since that's the column booking lists are always
-- ordered/filtered by alongside partner_id (see booking_items_starts_idx,
-- which indexes starts_at alone but doesn't help a partner_id-scoped query).
--
-- Safe to run more than once.
-- ===========================================================================

create index if not exists booking_items_partner_idx
  on public.booking_items using btree (partner_id, starts_at desc);
