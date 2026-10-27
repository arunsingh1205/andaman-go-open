-- ===========================================================================
-- Migration 123 — restore 6 anon grants that 122's lock-down incorrectly
-- dropped
--
-- 122 (16 Sep) revoked EXECUTE from `anon` on every public function except a
-- 7-function allowlist copied from the 7 Sep audit. That allowlist covered
-- what the audit reviewed, but it was never a complete inventory of what
-- this app's permanently-anon `lib/supabase.ts` client (and callers with no
-- session at all — webhooks, cron, the partner API) actually calls. Six
-- calls broke as a result, confirmed by grepping every `.rpc(...)` call made
-- through that client (`rg -n '\.rpc\(' lib app`, cross-referenced against
-- which files import `./supabase` specifically, not `./supabase-server` or
-- `./supabase-browser`) and checking each function's live anon privilege:
--
--   * stay_room_load        — lib/stays.ts, the public stay-availability
--     read every stays page needs before any session exists. Same shape as
--     cab_load_on/rental_load_on, which 122 already allowed — this one was
--     added later (096/097b) and simply missed.
--   * run_settlement_cron   — app/api/cron/settlement/route.ts. Vercel Cron
--     has no session; migration 105's own comment says this is "granted to
--     anon for exactly that reason" — guarded by a Supabase Vault secret,
--     not RLS. Broke the weekly settlement run.
--   * record_notification   — logs an email/WhatsApp send that already
--     happened (cron settlement emails, partner welcome/first-listing
--     emails). No guard beyond being a log-only insert; not reviewed as
--     unsafe by the 7 Sep audit, just omitted from the new allowlist by
--     oversight. Broke settlement/welcome notification logging.
--   * api_push_stay_availability, api_list_partner_bookings — the partner
--     API (099). No session by design — the caller authenticates with a
--     bearer API key the function hashes and checks itself
--     (lib/partner-api-auth.ts). Broke the partner API entirely.
--   * apply_razorpay_refund_webhook — Razorpay's server calling ours, no
--     session, no cookies. Migration 067's own comment: "granted to anon for
--     exactly that reason — this route is the actual gate, not RLS" (the
--     route verifies the HMAC signature before ever calling this). Broke
--     refund webhook processing.
--
-- All six were already guarded by something other than a database grant
-- (a secret, a signature, a hashed API key, or simply being a write-only
-- log with no PII exposure) — restoring anon EXECUTE does not reopen any of
-- the three findings 122 fixed.
--
-- Safe to run more than once.
-- ===========================================================================

grant execute on function public.stay_room_load(uuid[], date, date) to anon;
grant execute on function public.run_settlement_cron(date, date, text) to anon;
grant execute on function public.record_notification(text, text, text, text, text, text, text, jsonb, uuid, uuid, uuid, uuid) to anon;
grant execute on function public.api_push_stay_availability(text, text, text, jsonb) to anon;
grant execute on function public.api_list_partner_bookings(text, text, timestamp with time zone, integer) to anon;
grant execute on function public.apply_razorpay_refund_webhook(text, text, text) to anon;
