-- ===========================================================================
-- Migration 106 — the outbound side of a "booking just happened": a log of
-- every email/WhatsApp send this app owes someone, plus the trigger that
-- queues the booking ones.
--
-- Two delivery mechanisms already exist in this codebase and this migration
-- keeps using each where it already fits, rather than forcing everything
-- through one pipe:
--
--   · Booking notifications (to both the partner AND the customer) fire off
--     booking_items — the one table every booking path (create_booking,
--     create_cab_booking, create_stay_booking) shares — exactly the way
--     notify_partner_of_booking() (020) already does for the in-app feed.
--     A SECOND trigger, not a merge into that one: a failure queuing an
--     email must never stop the in-app notification from landing, or the
--     other way round.
--
--   · Welcome emails and settlement WhatsApp stay Node-direct, called right
--     after the RPC that triggers them succeeds (same shape lib/email.ts's
--     settlement senders already use) — record_notification() below is the
--     one door for that path to log what it sent.
--
-- Either path writes a row here; the actual send happens outside Postgres —
-- see supabase/functions/send-notification (new), wired to a Database
-- Webhook on notification_log insert (dashboard, not SQL — same as 094/
-- send-partner-push's PARTNER_PUSH_WEBHOOK_SECRET).
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. notification_log — one row per message this app owes someone, regardless
--    of which of the two paths above created it.
-- ---------------------------------------------------------------------------

create table if not exists notification_log (
  id                   uuid primary key default gen_random_uuid(),
  channel              text not null check (channel in ('email', 'whatsapp')),
  recipient_type       text not null check (recipient_type in ('partner', 'customer')),
  recipient_address    text not null,
  kind                 text not null check (kind in
                         ('partner_welcome', 'booking_new', 'settlement_ready', 'settlement_paid')),
  status               text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id  text,
  error                text,
  -- Everything the sender needs to build the message, captured once at the
  -- moment this row is written — so a resend doesn't have to re-join five
  -- tables to reconstruct what it already knew.
  payload              jsonb not null default '{}',
  partner_id           uuid references partners(id) on delete set null,
  user_id              uuid references auth.users(id) on delete set null,
  -- No FK, same reasoning as partner_notifications.item_id (020): a
  -- notification outlives the booking it describes.
  booking_item_id      uuid,
  settlement_batch_id  uuid references settlement_batches(id) on delete set null,
  -- Set when this row is a resend of an earlier one (admin "Resend" button).
  retry_of             uuid references notification_log(id) on delete set null,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);

create index if not exists notification_log_feed_idx on notification_log (created_at desc);
create index if not exists notification_log_pending_idx
  on notification_log (status) where status <> 'sent';

alter table notification_log enable row level security;

-- Admin-only — same shape as "admins see all settlement batches" (101).
-- Nobody else has a read policy: a partner or customer isn't meant to browse
-- this log, only get the message itself.
drop policy if exists "admins see notification log" on notification_log;
create policy "admins see notification log" on notification_log
  for select using (is_admin());

revoke all on notification_log from public;
grant select on notification_log to authenticated;


-- ---------------------------------------------------------------------------
-- 2. partners.whatsapp_number — separate from contact_phone (free-text,
--    unverified, not necessarily WhatsApp-reachable). Null until an admin (or
--    the partner, later) sets one; a booking/settlement WhatsApp send is
--    simply skipped for a partner with none on file.
-- ---------------------------------------------------------------------------

alter table partners add column if not exists whatsapp_number text;

comment on column partners.whatsapp_number is
  'E.164 WhatsApp number for transactional sends (booking/settlement, 106). Distinct from contact_phone — free-text and unverified. Null means no WhatsApp sent for this partner.';


-- ---------------------------------------------------------------------------
-- 3. record_notification — the one door for the Node-direct path (welcome
--    email, settlement WhatsApp) to log what it just sent. Granted to anon
--    too: the settlement cron route runs with the anon key and no session,
--    same reasoning run_settlement_cron (105) is already granted to anon.
--
--    Every field is constrained by the table's own CHECK constraints, so
--    this is a low-risk surface to expose even without an is_admin() gate —
--    the same tradeoff already accepted for run_settlement_cron.
-- ---------------------------------------------------------------------------

create or replace function record_notification(
  p_channel text,
  p_recipient_type text,
  p_recipient_address text,
  p_kind text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null,
  p_payload jsonb default '{}',
  p_partner_id uuid default null,
  p_user_id uuid default null,
  p_booking_item_id uuid default null,
  p_settlement_batch_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into notification_log (
    channel, recipient_type, recipient_address, kind, status, provider_message_id,
    error, payload, partner_id, user_id, booking_item_id, settlement_batch_id, sent_at
  ) values (
    p_channel, p_recipient_type, p_recipient_address, p_kind, p_status, p_provider_message_id,
    p_error, p_payload, p_partner_id, p_user_id, p_booking_item_id, p_settlement_batch_id,
    case when p_status = 'sent' then now() else null end
  ) returning id into v_id;

  return v_id;
end $$;

revoke all on function record_notification(
  text, text, text, text, text, text, text, jsonb, uuid, uuid, uuid, uuid
) from public;
grant execute on function record_notification(
  text, text, text, text, text, text, text, jsonb, uuid, uuid, uuid, uuid
) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. notify_booking_comms — the fan-out for booking notifications. A second
--    trigger on booking_items, alongside 020's booking_items_notify_partner,
--    covering every booking path since they all insert here (008, 049, 097).
--
--    Queues up to 4 rows: partner email, partner WhatsApp, customer email,
--    customer WhatsApp — skipping any channel with no address on file. The
--    actual send (and whether WhatsApp is even configured yet) is entirely
--    the Edge Function's problem, not this trigger's — see supabase/
--    functions/send-notification.
-- ---------------------------------------------------------------------------

create or replace function notify_booking_comms() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title           text;
  v_when            text;
  v_owner_email     text;
  v_partner_whatsapp text;
  v_customer_id     uuid;
  v_customer_email  text;
  v_customer_phone  text;
  v_customer_name   text;
begin
  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
  v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');

  select u.email::text, p.whatsapp_number
    into v_owner_email, v_partner_whatsapp
  from partners p
  left join lateral (
    select pu.user_id
    from partner_users pu
    where pu.partner_id = new.partner_id and pu.role = 'owner'
    order by pu.created_at asc
    limit 1
  ) owner on true
  left join auth.users u on u.id = owner.user_id
  where p.id = new.partner_id;

  select b.user_id, b.contact_email, b.contact_phone, b.contact_name
    into v_customer_id, v_customer_email, v_customer_phone, v_customer_name
  from bookings b where b.id = new.booking_id;

  if v_owner_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'email', 'partner', v_owner_email, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'party', new.party, 'kind', new.kind),
      new.partner_id, new.id
    );
  end if;

  if v_partner_whatsapp is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, partner_id, booking_item_id)
    values (
      'whatsapp', 'partner', v_partner_whatsapp, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'party', new.party, 'kind', new.kind),
      new.partner_id, new.id
    );
  end if;

  if v_customer_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'email', 'customer', v_customer_email, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'name', v_customer_name),
      v_customer_id, new.id
    );
  end if;

  if v_customer_phone is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values (
      'whatsapp', 'customer', v_customer_phone, 'booking_new',
      jsonb_build_object('title', v_title, 'when', v_when, 'name', v_customer_name),
      v_customer_id, new.id
    );
  end if;

  return null;
end $$;

drop trigger if exists booking_items_notify_comms on booking_items;
create trigger booking_items_notify_comms
after insert on booking_items
for each row execute function notify_booking_comms();


-- ---------------------------------------------------------------------------
-- 5. admin_list_partner_owner_emails — feeds the Communications admin page's
--    one-time "send welcome email to every partner who hasn't had one" button
--    (lib/admin-communications.ts::backfillPartnerWelcomeEmails). Node does
--    the skip-if-already-sent check itself against notification_log, so this
--    just hands back every partner's current owner email.
-- ---------------------------------------------------------------------------

create or replace function admin_list_partner_owner_emails()
returns table (partner_id uuid, partner_name text, owner_email text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, u.email::text
    from partners p
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = p.id and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    where u.email is not null;
end $$;

revoke all on function admin_list_partner_owner_emails() from public;
grant execute on function admin_list_partner_owner_emails() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. admin_resend_notification — the Communications admin page's "Resend"
--    button on a failed row. Inserts a fresh 'pending' row carrying the same
--    channel/recipient/kind/payload, with retry_of pointing at the original —
--    the same Database Webhook that sends every other row then picks this one
--    up too, so there is no second send code path to maintain.
-- ---------------------------------------------------------------------------

create or replace function admin_resend_notification(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row notification_log%rowtype;
  v_new_id uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select * into v_row from notification_log where id = p_id;
  if v_row.id is null then
    raise exception 'notification not found' using errcode = '42704';
  end if;

  insert into notification_log (
    channel, recipient_type, recipient_address, kind, payload,
    partner_id, user_id, booking_item_id, settlement_batch_id, retry_of
  ) values (
    v_row.channel, v_row.recipient_type, v_row.recipient_address, v_row.kind, v_row.payload,
    v_row.partner_id, v_row.user_id, v_row.booking_item_id, v_row.settlement_batch_id, v_row.id
  ) returning id into v_new_id;

  return v_new_id;
end $$;

revoke all on function admin_resend_notification(uuid) from public;
grant execute on function admin_resend_notification(uuid) to authenticated;


select 'notification log + booking comms trigger installed' as done;
