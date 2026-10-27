-- ===========================================================================
-- Migration 122 — lock down the RPC surface (closes the 7 Sep audit's
-- three open findings)
--
-- 1. Revoke EXECUTE on every public-schema function from PUBLIC and from
--    anon. 24 functions were granted straight to PUBLIC (which every role,
--    anon included, inherits) rather than to anon specifically — a plain
--    "revoke from anon" does nothing for those, so PUBLIC has to be revoked
--    too. Before touching anything, `authenticated` is explicitly re-granted
--    EXECUTE on any function it currently reaches only through the PUBLIC
--    grant, so nothing a signed-in (including anonymous-auth) traveller,
--    partner or admin session already does changes. `service_role` is never
--    referenced here and keeps its own separate grants untouched.
--
-- 2. Re-grants anon exactly the 7 read-only, no-PII functions that must
--    survive the race where a page renders before SessionBoot's anonymous
--    sign-in resolves: cab_load_on, rental_load_on, listing_is_public,
--    listing_reviews, subject_title, partner_name, partner_photo_path.
--
-- 3. partner_phone / partner_address / partner_maps_url are SECURITY
--    DEFINER with no guard, so they run as the owner and bypass partners'
--    RLS ("approved partners are public", `status = 'approved'`) entirely.
--    Every partner row is approved today, but 15 of 31 are not (pending/
--    deleted) as of 16 Sep, so this is a live leak, not a theoretical one.
--    Matched to the exact RLS predicate: only return the value when the
--    partner is approved, else null.
--
-- 4. Drops refund_booking(text) — dead since cancel_my_booking_item (032)
--    replaced it as the real cancellation path. Confirmed via
--    `rg -n "refund_booking" app lib` (nothing outside supabase/004's
--    definition and 032's comment referencing it): any signed-in traveller
--    could otherwise mark their own booking items 'refunded' with no
--    cancellation-window check, no refund amount recorded, and no operator
--    notification.
--
-- Deferred deliberately (per the audit): a further pass tightening what
-- `authenticated` itself can reach (e.g. partner-only RPCs from a
-- traveller's anonymous session) — that needs the app exercised against a
-- tightened grant set first, not a blind revoke.
--
-- Applied directly to the live Mumbai project (<your-project-ref>) via the
-- Supabase MCP tool on 16 Sep 2026; verified after: anon-callable functions
-- 174 -> 7, admin_* anon-callable 0, authenticated-callable unchanged apart
-- from the dropped function (173 -> 172), refund_booking gone, security
-- advisor SECURITY DEFINER/anon warning count 100(capped) -> 7.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Strip PUBLIC and anon from every public-schema function, preserving
--    authenticated's current access explicitly first.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  authenticated_oid oid := (select oid from pg_roles where rolname = 'authenticated');
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    if has_function_privilege('authenticated', r.oid, 'execute')
       and not exists (
         select 1
         from aclexplode(
           coalesce(
             (select proacl from pg_proc where oid = r.oid),
             acldefault('f', (select proowner from pg_proc where oid = r.oid))
           )
         ) a
         where a.grantee = authenticated_oid and a.privilege_type = 'EXECUTE'
       )
    then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;

    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The narrow anon allowlist.
-- ---------------------------------------------------------------------------
grant execute on function public.cab_load_on(date) to anon;
grant execute on function public.rental_load_on(date) to anon;
grant execute on function public.listing_is_public(text, uuid) to anon;
grant execute on function public.listing_reviews(text, text) to anon;
grant execute on function public.subject_title(text, uuid) to anon;
grant execute on function public.partner_name(uuid) to anon;
grant execute on function public.partner_photo_path(uuid) to anon;

-- ---------------------------------------------------------------------------
-- 3. Status-guard the three SECURITY DEFINER partner PII readers.
-- ---------------------------------------------------------------------------
create or replace function public.partner_phone(p_partner_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select contact_phone from partners where id = p_partner_id and status = 'approved'
$function$;

create or replace function public.partner_address(p_partner_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select address from partners where id = p_partner_id and status = 'approved'
$function$;

create or replace function public.partner_maps_url(p_partner_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select maps_url from partners where id = p_partner_id and status = 'approved'
$function$;

-- ---------------------------------------------------------------------------
-- 4. Drop the dead, unguarded cancellation path.
-- ---------------------------------------------------------------------------
drop function if exists public.refund_booking(text);
