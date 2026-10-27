-- ===========================================================================
-- Migration 124 — restore anon EXECUTE on RLS-embedded helper functions
-- broken by migration 122
--
-- Migration 122's blanket revoke correctly stripped anon's ability to call
-- SECURITY DEFINER RPCs directly, but it also revoked EXECUTE on three
-- internal helper functions that are referenced INSIDE "admins/owners see
-- all X" PERMISSIVE RLS policies on ~30+ public-schema tables:
--   - is_admin()
--   - is_partner_for_booking(uuid)
--   - listing_partner_id(text, uuid)
--
-- Postgres evaluates every disjunct of an OR-combined set of PERMISSIVE
-- policies for a query, regardless of which policy would actually grant
-- access — so once anon lost EXECUTE on is_admin(), ANY anon-role query
-- against a table with an "admins see all" policy started failing outright
-- with "permission denied for function is_admin", even where a completely
-- unrelated "public can read" policy on the same table would otherwise have
-- allowed the row. This broke anon-role reads across most of the schema
-- (e.g. GET /rest/v1/partners), which is why andamango.in/explore and
-- other pages went down after 122 — a much bigger blast radius than the 6
-- RPCs already restored in migration 123.
--
-- These three functions only ever return a boolean/uuid derived from the
-- calling role's own auth.uid()/auth.jwt(); granting anon EXECUTE lets the
-- planner evaluate them for a sessionless request (they simply return
-- false/null), it does not grant anon any additional data access — RLS
-- itself, and what rows anon can actually see, is unchanged by this.
--
-- Confirmed via pg_policies: these are the only 3 public-schema functions
-- (besides the already-restored 122 allowlist and the 123 fixes) referenced
-- in any policy qual/with_check across the schema.
--
-- Safe to run more than once.
-- ===========================================================================

grant execute on function public.is_admin() to anon;
grant execute on function public.is_partner_for_booking(uuid) to anon;
grant execute on function public.listing_partner_id(text, uuid) to anon;
