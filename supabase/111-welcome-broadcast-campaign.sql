-- ===========================================================================
-- Migration 111 — the partner welcome email moves onto the Broadcasts
-- composer instead of the separate structured-fields editor (108), so
-- there's one place to author partner emails, not two.
--
--   · broadcast_campaigns (109) gains is_welcome_template — at most one row
--     may have it true (enforced by the partial unique index below). That
--     row is exempt from the normal "locked after sent" campaign lifecycle:
--     it's a standing template, re-read on every new signup and every
--     backfill run, not a one-shot announcement.
--   · A new SELECT policy exposes ONLY that row (is_welcome_template = true)
--     to anon/authenticated — the signup flow (lib/partner-register.ts,
--     no admin session) and the Edge Function's resend path both need to
--     read it. Every other campaign stays admin-only, same as before.
--   · notification_templates (108) and its partner_welcome row are left in
--     place but no longer read by anything — harmless, not worth a
--     destructive migration to remove.
--
-- Safe to run more than once.
-- ===========================================================================

alter table broadcast_campaigns add column if not exists is_welcome_template boolean not null default false;

comment on column broadcast_campaigns.is_welcome_template is
  'True for the one standing campaign used as the partner welcome email (111) — always editable, never locked by status, re-read on every signup/backfill rather than sent once.';

create unique index if not exists broadcast_campaigns_one_welcome_template
  on broadcast_campaigns ((true)) where is_welcome_template;

drop policy if exists "anyone reads the welcome template" on broadcast_campaigns;
create policy "anyone reads the welcome template" on broadcast_campaigns
  for select using (is_welcome_template);

grant select on broadcast_campaigns to anon;

select 'welcome broadcast campaign installed' as done;
