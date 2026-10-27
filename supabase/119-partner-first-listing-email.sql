-- ===========================================================================
-- Migration 119 — first-listing partner email: the commission-guide PDF +
-- HTML walkthrough, sent once per partner the first time they add ANY
-- listing (activity/vehicle/stay/event/community service/trip/sailing) —
-- regardless of whether the business or listing is approved yet. Node-direct
-- send (lib/email.ts::sendPartnerFirstListingEmail, called from each
-- addPartnerX in lib/partner-register.ts), same fire-and-forget +
-- record_notification (106) logging shape as the partner_welcome email in
-- registerPartner().
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. partners.first_listing_email_sent — the one-shot gate. Flipped by a
--    conditional UPDATE ("... where first_listing_email_sent = false")
--    inside maybeSendFirstListingEmail(), so two listings added back-to-back
--    (even different categories) can't both win the race and double-send.
-- ---------------------------------------------------------------------------

alter table partners add column if not exists first_listing_email_sent boolean not null default false;

comment on column partners.first_listing_email_sent is
  'Set true the first time this partner adds any listing (any category) — gates the one-time commission-guide email. Not tied to business/listing approval status. See lib/partner-register.ts::maybeSendFirstListingEmail.';


-- ---------------------------------------------------------------------------
-- 2. notification_log.kind — add 'first_listing' alongside the existing four.
--    Dropped/re-added by name lookup rather than a hardcoded constraint name,
--    since the original (106) let Postgres pick the name.
-- ---------------------------------------------------------------------------

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'notification_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%';

  if v_conname is not null then
    execute format('alter table notification_log drop constraint %I', v_conname);
  end if;
end $$;

alter table notification_log add constraint notification_log_kind_check
  check (kind in ('partner_welcome', 'booking_new', 'settlement_ready', 'settlement_paid', 'first_listing'));


select 'partner first-listing email column + notification kind installed' as done;
