-- ===========================================================================
-- Migration 126 — push notifications for travellers, plus the notification
-- customers were never actually getting: a booking changing state after it's
-- made.
--
-- notify_booking_comms() (106) only fires on INSERT — the moment a booking
-- is created. Everything that happens to it afterwards (an operator
-- confirming a pending cab-rate-card booking, weather disrupting it, an
-- admin cancelling it with a refund) already reaches the partner, via
-- notify_partner_of_booking()'s UPDATE branch (020/023) — but never reaches
-- the customer, on any channel. This closes that gap and adds push as a
-- third delivery channel alongside the existing email/WhatsApp, reusing the
-- same notification_log + send-notification pipeline rather than building a
-- separate one (unlike the partner side, where push rides on the separate
-- partner_notifications in-app feed — there's no customer-facing in-app feed
-- to hang push off here, so it goes through notification_log like email and
-- WhatsApp already do).
--
-- Three transitions get a customer notification, deliberately matching (and
-- no wider than) what the partner side already treats as notification-worthy:
--   · state -> 'confirmed' (from 'pending') — mainly rate-card cabs, where a
--     booking starts pending until an operator is assigned (078/082).
--   · state -> 'disrupted' — same condition as notify_partner_of_booking's
--     'disrupted' branch (023).
--   · state -> 'refunded' with a cancelled_note — same condition as
--     notify_partner_of_booking's 'booking_cancelled' branch (023).
-- 'completed'/'missed' are deliberately not covered — a review-prompt-on-
-- completion is a different feature, and 'missed' is an operator-side
-- no-show marking that doesn't obviously want push urgency.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. traveller_push_tokens — same shape as partner_push_tokens (094), keyed
--    directly by auth.uid() rather than through a partner_users-style link
--    table, since the traveller *is* the auth user (same identity
--    my_bookings/bookings.user_id already uses). A device re-registers on
--    every app open (harmless, `on conflict` just bumps last_seen_at); if a
--    phone is shared and a different person opens the app, the same token
--    simply moves to the new user_id instead of leaving a stale row.
-- ---------------------------------------------------------------------------

create table if not exists traveller_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('android', 'ios')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists traveller_push_tokens_user_idx
  on traveller_push_tokens (user_id);

alter table traveller_push_tokens enable row level security;

-- No select/insert/update/delete policy for anyone — same reasoning as
-- partner_push_tokens: a traveller has no reason to read their own device
-- tokens back, the only writer is the SECURITY DEFINER RPC below, and the
-- trigger that reads this table to queue a push runs SECURITY DEFINER too.
revoke all on traveller_push_tokens from public;


-- ---------------------------------------------------------------------------
-- register_traveller_push_token — "this device belongs to me now."
-- ---------------------------------------------------------------------------

create or replace function register_traveller_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or trim(p_token) = '' then
    raise exception 'a push token is required' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;

  insert into traveller_push_tokens (user_id, token, platform)
  values (auth.uid(), trim(p_token), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now();
end $$;

revoke all on function register_traveller_push_token(text, text) from public;
grant execute on function register_traveller_push_token(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. notification_log.channel — add 'push' alongside 'email'/'whatsapp'.
--    notification_log.kind — add the three state-change kinds. Both dropped/
--    re-added by name lookup rather than a hardcoded constraint name, same
--    pattern 119 already used for adding 'first_listing'.
-- ---------------------------------------------------------------------------

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'notification_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%channel%';

  if v_conname is not null then
    execute format('alter table notification_log drop constraint %I', v_conname);
  end if;
end $$;

alter table notification_log add constraint notification_log_channel_check
  check (channel in ('email', 'whatsapp', 'push'));

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
  check (kind in (
    'partner_welcome', 'booking_new', 'settlement_ready', 'settlement_paid', 'first_listing',
    'booking_confirmed', 'booking_disrupted', 'booking_refunded'
  ));


-- ---------------------------------------------------------------------------
-- 3. notify_booking_state_change — the UPDATE-side fan-out, alongside
--    notify_booking_comms' INSERT-side one (106). A separate trigger rather
--    than folding into that one, same reasoning 106 gave for being separate
--    from notify_partner_of_booking (020): a failure queuing one channel
--    must never stop another from landing.
--
--    Queues one email row, one WhatsApp row, and one push row per registered
--    device (skipping any channel/device with nothing on file) — the actual
--    send is send-notification's problem, same as every other row here.
-- ---------------------------------------------------------------------------

create or replace function notify_booking_state_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind            text;
  v_title_text      text;
  v_body_title      text;
  v_title           text;
  v_when            text;
  v_customer_id     uuid;
  v_customer_email  text;
  v_customer_phone  text;
  v_customer_name   text;
  v_payload         jsonb;
  v_token           text;
begin
  if TG_OP <> 'UPDATE' or old.state is not distinct from new.state then
    return null;
  end if;

  if new.state = 'confirmed' and old.state = 'pending' then
    v_kind := 'booking_confirmed';
    v_body_title := 'Booking confirmed';
  elsif new.state = 'disrupted' then
    v_kind := 'booking_disrupted';
    v_body_title := 'Booking disrupted — weather';
  elsif new.state = 'refunded'
    and new.cancelled_note is not null
    and coalesce(old.cancelled_note, '') is distinct from new.cancelled_note then
    v_kind := 'booking_refunded';
    v_body_title := 'You''ve been refunded';
  else
    return null;
  end if;

  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
  v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');

  select b.user_id, b.contact_email, b.contact_phone, b.contact_name
    into v_customer_id, v_customer_email, v_customer_phone, v_customer_name
  from bookings b where b.id = new.booking_id;

  v_payload := jsonb_build_object(
    'title', v_title, 'when', v_when, 'name', v_customer_name, 'note', new.cancelled_note
  );

  if v_customer_email is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values ('email', 'customer', v_customer_email, v_kind, v_payload, v_customer_id, new.id);
  end if;

  if v_customer_phone is not null then
    insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
    values ('whatsapp', 'customer', v_customer_phone, v_kind, v_payload, v_customer_id, new.id);
  end if;

  if v_customer_id is not null then
    for v_token in
      select token from traveller_push_tokens where user_id = v_customer_id
    loop
      insert into notification_log (channel, recipient_type, recipient_address, kind, payload, user_id, booking_item_id)
      values ('push', 'customer', v_token, v_kind, v_payload || jsonb_build_object('push_title', v_body_title), v_customer_id, new.id);
    end loop;
  end if;

  return null;
end $$;

drop trigger if exists booking_items_notify_state_change on booking_items;
create trigger booking_items_notify_state_change
after update on booking_items
for each row execute function notify_booking_state_change();


select 'traveller push tokens + booking state-change notifications installed' as done;
