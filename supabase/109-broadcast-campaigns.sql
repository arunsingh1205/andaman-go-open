-- ===========================================================================
-- Migration 109 — one-off broadcast emails to partners, composed as raw
-- HTML in the admin Communications page.
--
-- Deliberately separate from notification_templates (108) and
-- notification_log (106): those two are the automated transactional
-- pipeline (welcome/booking/settlement — fixed layouts, triggered by app
-- events, fanned out through the send-notification Edge Function). A
-- broadcast is the opposite shape — one-off, admin-authored, admin-timed,
-- arbitrary HTML — so it gets its own table and its own (synchronous,
-- Node-side) send path rather than being forced through the trigger/webhook
-- machinery built for something else.
--
-- Admin-only end to end: nothing here is ever read by a send-path outside
-- the admin session, unlike notification_templates' public SELECT.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists broadcast_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  subject           text not null default '',
  html              text not null default '',
  status            text not null default 'draft' check (status in ('draft', 'sent')),
  recipients_sent   int not null default 0,
  recipients_failed int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_at           timestamptz
);

create index if not exists broadcast_campaigns_created_idx on broadcast_campaigns (created_at desc);

alter table broadcast_campaigns enable row level security;

drop policy if exists "admin manages broadcast campaigns" on broadcast_campaigns;
create policy "admin manages broadcast campaigns" on broadcast_campaigns
  for all using (is_admin()) with check (is_admin());

revoke all on broadcast_campaigns from public;
grant select, insert, update, delete on broadcast_campaigns to authenticated;

select 'broadcast campaigns installed' as done;
