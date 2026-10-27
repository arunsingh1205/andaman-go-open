-- notification_log.kind's check constraint never had 'partner_onboarding'
-- added to it — every record_notification call from the ops onboarding
-- flow (131) has been failing with a 400 as a result (confirmed via
-- edge_logs: the send itself succeeds, Resend/Twilio both confirm
-- delivery, but the log write is rejected before it ever reaches the
-- table). Doesn't affect delivery, just tracking.

alter table notification_log drop constraint notification_log_kind_check;

alter table notification_log add constraint notification_log_kind_check
  check (kind = any (array[
    'partner_welcome', 'booking_new', 'settlement_ready', 'settlement_paid',
    'first_listing', 'booking_confirmed', 'booking_disrupted', 'booking_refunded',
    'partner_onboarding'
  ]));

select 'notification_log now accepts partner_onboarding' as done;
