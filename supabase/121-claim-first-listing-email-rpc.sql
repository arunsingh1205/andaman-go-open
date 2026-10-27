-- ===========================================================================
-- Migration 121 — fixes a bug in 119/120: partners has no RLS UPDATE policy
-- (every other write to this table goes through a SECURITY DEFINER RPC, per
-- 027-owner-only-writes.sql's own pattern) — so the raw
-- `.from("partners").update({ first_listing_email_sent: true })` calls in
-- maybeSendFirstListingEmail() (lib/partner-register.ts) and
-- backfillFirstListingEmails() (lib/admin-broadcasts.ts) were silently
-- denied by RLS. Silently, because Postgres/PostgREST return zero rows
-- rather than an error for a row an UPDATE's RLS policy filters out — so
-- both the live auto-send AND the backfill "worked" without ever actually
-- sending anything. This RPC replaces both raw updates.
--
-- Callable by: an admin (the backfill, claiming on behalf of any partner),
-- or a user linked to that partner_id via partner_users, any role — same
-- who-can-act-for-this-business check assert_partner_owner() uses elsewhere,
-- except this deliberately allows staff too (not owner-only): any addPartnerX
-- caller may be staff, not just the owner, and adding a listing is already
-- something staff can do.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function claim_first_listing_email(p_partner_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_claimed boolean;
begin
  if not (
    is_admin()
    or exists (
      select 1 from partner_users pu
      where pu.partner_id = p_partner_id and pu.user_id = auth.uid()
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update partners
    set first_listing_email_sent = true
    where id = p_partner_id and first_listing_email_sent = false
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;

revoke all on function claim_first_listing_email(uuid) from public;
grant execute on function claim_first_listing_email(uuid) to authenticated;

select 'claim_first_listing_email RPC installed' as done;
