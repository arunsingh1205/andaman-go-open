-- ===========================================================================
-- Migration 108 — the partner welcome email's copy, editable from the admin
-- Communications page instead of living only in code.
--
-- Scope: just the welcome email for now (the one template with a rich,
-- designed layout, 2026-09-14). The structure/HTML/colours stay fixed in
-- lib/email.ts and supabase/functions/send-notification — only the text
-- content is admin-editable, stored here as jsonb keyed by field name. This
-- is deliberate: letting an admin edit raw HTML risks breaking the
-- Outlook/Gmail-safe table markup; a fixed layout with editable copy can't
-- be broken that way.
--
-- One row per template (template_key), read by both send paths: lib/email.ts
-- (Node, anon client, for the immediate send) and the Edge Function (service
-- role, for a resend). Public SELECT — this is marketing copy, not sensitive
-- data — write restricted to admins.
--
-- Safe to run more than once (the seed insert is ON CONFLICT DO NOTHING, so
-- it won't clobber an admin's edits on a second run).
-- ===========================================================================

create table if not exists notification_templates (
  id           uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  fields       jsonb not null default '{}',
  updated_at   timestamptz not null default now()
);

alter table notification_templates enable row level security;

drop policy if exists "anyone reads notification templates" on notification_templates;
create policy "anyone reads notification templates" on notification_templates
  for select using (true);

drop policy if exists "admin writes notification templates" on notification_templates;
create policy "admin writes notification templates" on notification_templates
  for all using (is_admin()) with check (is_admin());

revoke all on notification_templates from public;
grant select on notification_templates to anon, authenticated;
grant insert, update, delete on notification_templates to authenticated;

insert into notification_templates (template_key, fields) values (
  'partner_welcome',
  '{
    "heroHeadingLine1": "Welcome",
    "heroHeadingLine2": "to the islands.",
    "heroBody": "Your business is now part of Andaman Go, the booking app for island travel. Visitors can find you, book you and pay you in one place.",
    "tagline": "Ferries, rides, activities and tables across the Andaman Islands. In one app.",
    "whatWeAreHeading": "From the jetty to the last table on the beach.",
    "whatWeAreBody": "Ferries, rides, activities and tables across the Andaman Islands. In one app. We bring local operators like you and visitors together in a single, trusted place, so a trip is planned in minutes and every booking is confirmed on the spot.",
    "whatWeOfferHeading": "Six things every island day needs.",
    "offerCards": [
      {"title": "Rental scooty", "detail": "Book a ride, pick up in minutes."},
      {"title": "Ferry", "detail": "Seats, live schedule & e-ticket."},
      {"title": "Activities", "detail": "Scuba, snorkelling, island tour."},
      {"title": "Events & DJ", "detail": "Passes for nights that match your vibe."},
      {"title": "Trips by locals", "detail": "Itineraries planned by people who live here."},
      {"title": "Reserve table", "detail": "A seat at your favourite place, held for you."}
    ],
    "missionText": "Make every part of an island trip bookable in one place, with local operators paid fairly and on time.",
    "visionText": "The single, trusted way to travel the Andaman Islands.",
    "nextStepsHeading": "Three steps before the tide turns.",
    "nextSteps": [
      "Open the app and sign in with this email.",
      "Add your services, prices and availability.",
      "Confirm payout details. Bookings start arriving."
    ],
    "closingHeading": "Everything the trip needs, in one place. See you on the shore."
  }'::jsonb
)
on conflict (template_key) do nothing;

select 'notification templates installed' as done;
