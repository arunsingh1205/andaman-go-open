-- ===========================================================================
-- Migration 152 — report and block on the booking message thread
--
-- The one place a traveller and a partner exchange free-text content
-- (booking_messages, 022) has never had a way for either side to report
-- abuse or stop hearing from the other — App Review (Guideline 1.2 /
-- 2.1) expects both on any user-generated-content channel. This adds them
-- without touching booking_messages itself:
--
--   * booking_items gains messages_blocked_by / messages_blocked_at — who
--     froze this one booking's thread, and when. Whoever blocks it is the
--     only one who can lift it; the other side just sees it's closed.
--   * booking_message_reports is a new table, one row per report, read
--     only by admins (through admin_message_reports below) — nothing about
--     it is exposed to the traveller or partner who filed it.
--   * traveller_send_message / partner_send_message (022) gain one more
--     early guard, right alongside their existing empty/too-long checks:
--     a blocked thread refuses new messages from either side.
--   * Four new twin RPCs (traveller_/partner_ prefixed, same shape as
--     every other dual-sided action in this schema — see
--     traveller_send_message vs partner_send_message, or
--     cancel_my_booking_item vs partner_cancel_booking_item) for
--     block/unblock/report/status.
--
-- Safe to run more than once.
-- ===========================================================================

alter table booking_items
  add column if not exists messages_blocked_by text
    check (messages_blocked_by in ('traveller', 'partner')),
  add column if not exists messages_blocked_at timestamptz;


-- ---------------------------------------------------------------------------
-- 1. booking_message_reports — admin-only; nobody reads their own report
--    back, the same way nobody sees the other side's rejection_reason
--    until an admin acts on it.
-- ---------------------------------------------------------------------------

create table if not exists booking_message_reports (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references booking_items(id) on delete cascade,
  booking_id  uuid not null references bookings(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  reported_by text not null check (reported_by in ('traveller', 'partner')),
  reason      text not null,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
);

create index if not exists booking_message_reports_item_idx
  on booking_message_reports (item_id);
create index if not exists booking_message_reports_status_idx
  on booking_message_reports (status, created_at);

alter table booking_message_reports enable row level security;

drop policy if exists "admins see all message reports" on booking_message_reports;
create policy "admins see all message reports" on booking_message_reports
  for select using (is_admin());

revoke all on booking_message_reports from public;
grant select on booking_message_reports to authenticated;


-- ---------------------------------------------------------------------------
-- 2. traveller_send_message / partner_send_message — same bodies as 022,
--    plus the blocked-thread guard. Same signatures, so CREATE OR REPLACE
--    is safe.
-- ---------------------------------------------------------------------------

create or replace function traveller_send_message(p_item_id uuid, p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_booking uuid;
  v_partner uuid;
  v_blocked text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text; return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text; return;
  end if;

  select i.booking_id, i.partner_id, i.messages_blocked_by
    into v_booking, v_partner, v_blocked
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is not null then
    return query select false, 'This conversation is closed.'::text; return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'traveller', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;

revoke all on function traveller_send_message(uuid, text) from public;
grant execute on function traveller_send_message(uuid, text) to authenticated;

create or replace function partner_send_message(p_item_id uuid, p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_booking uuid;
  v_blocked text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text; return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text; return;
  end if;

  select i.booking_id, i.messages_blocked_by into v_booking, v_blocked
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is not null then
    return query select false, 'This conversation is closed.'::text; return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'partner', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;

revoke all on function partner_send_message(uuid, text) from public;
grant execute on function partner_send_message(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Block / unblock — whoever blocks is the only one who can lift it.
--    Blocking a thread that's already blocked (by either side) is a no-op
--    that still reports ok, same as redeem_booking's "already checked in"
--    shape (005) — replaying an action isn't an error.
-- ---------------------------------------------------------------------------

create or replace function traveller_block_thread(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_booking uuid;
  v_blocked text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.booking_id, i.messages_blocked_by into v_booking, v_blocked
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is not null then
    return query select true, 'Already blocked.'::text; return;
  end if;

  update booking_items set messages_blocked_by = 'traveller', messages_blocked_at = now()
  where id = p_item_id;

  return query select true, 'Blocked — they can no longer message you here.'::text;
end $$;

revoke all on function traveller_block_thread(uuid) from public;
grant execute on function traveller_block_thread(uuid) to authenticated;

create or replace function partner_block_thread(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_booking uuid;
  v_blocked text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.booking_id, i.messages_blocked_by into v_booking, v_blocked
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is not null then
    return query select true, 'Already blocked.'::text; return;
  end if;

  update booking_items set messages_blocked_by = 'partner', messages_blocked_at = now()
  where id = p_item_id;

  return query select true, 'Blocked — they can no longer message you here.'::text;
end $$;

revoke all on function partner_block_thread(uuid) from public;
grant execute on function partner_block_thread(uuid) to authenticated;

create or replace function traveller_unblock_thread(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_booking uuid;
  v_blocked text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.booking_id, i.messages_blocked_by into v_booking, v_blocked
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is distinct from 'traveller' then
    return query select false, 'Nothing to unblock.'::text; return;
  end if;

  update booking_items set messages_blocked_by = null, messages_blocked_at = null
  where id = p_item_id;

  return query select true, 'Unblocked.'::text;
end $$;

revoke all on function traveller_unblock_thread(uuid) from public;
grant execute on function traveller_unblock_thread(uuid) to authenticated;

create or replace function partner_unblock_thread(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_booking uuid;
  v_blocked text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.booking_id, i.messages_blocked_by into v_booking, v_blocked
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;
  if v_blocked is distinct from 'partner' then
    return query select false, 'Nothing to unblock.'::text; return;
  end if;

  update booking_items set messages_blocked_by = null, messages_blocked_at = null
  where id = p_item_id;

  return query select true, 'Unblocked.'::text;
end $$;

revoke all on function partner_unblock_thread(uuid) from public;
grant execute on function partner_unblock_thread(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Report — files a row for admin_message_reports below. Blocking is the
--    self-serve stop-hearing-from-them action; reporting is the one that
--    tells Andaman Go, independent of whether the reporter also blocks.
-- ---------------------------------------------------------------------------

create or replace function traveller_report_thread(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_booking uuid;
  v_partner uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Tell us what happened.'::text; return;
  end if;
  if length(p_reason) > 2000 then
    return query select false, 'Keep it under 2000 characters.'::text; return;
  end if;

  select i.booking_id, i.partner_id into v_booking, v_partner
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;

  insert into booking_message_reports (item_id, booking_id, partner_id, reported_by, reason)
  values (p_item_id, v_booking, v_partner, 'traveller', trim(p_reason));

  return query select true, 'Reported. Our team will take a look.'::text;
end $$;

revoke all on function traveller_report_thread(uuid, text) from public;
grant execute on function traveller_report_thread(uuid, text) to authenticated;

create or replace function partner_report_thread(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_booking uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Tell us what happened.'::text; return;
  end if;
  if length(p_reason) > 2000 then
    return query select false, 'Keep it under 2000 characters.'::text; return;
  end if;

  select i.booking_id into v_booking
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner;

  if v_booking is null then
    return query select false, 'Booking not found.'::text; return;
  end if;

  insert into booking_message_reports (item_id, booking_id, partner_id, reported_by, reason)
  values (p_item_id, v_booking, v_partner, 'partner', trim(p_reason));

  return query select true, 'Reported. Our team will take a look.'::text;
end $$;

revoke all on function partner_report_thread(uuid, text) from public;
grant execute on function partner_report_thread(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Thread status — whether THIS caller's side has a block in effect, and
--    who set it, so the UI can grey out the composer and say why.
-- ---------------------------------------------------------------------------

create or replace function traveller_thread_status(p_item_id uuid)
returns table (blocked_by text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select i.messages_blocked_by
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;
end $$;

revoke all on function traveller_thread_status(uuid) from public;
grant execute on function traveller_thread_status(uuid) to authenticated;

create or replace function partner_thread_status(p_item_id uuid)
returns table (blocked_by text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  return query
  select i.messages_blocked_by
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner;
end $$;

revoke all on function partner_thread_status(uuid) from public;
grant execute on function partner_thread_status(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. admin_message_reports — the queue the new admin Reports tab reads,
--    joined out to the details that matter for triage (same shape as
--    admin_bookings/admin_support_threads: a read-only view gated on
--    is_admin(), security_invoker so it runs as the caller).
-- ---------------------------------------------------------------------------

create or replace view admin_message_reports as
select
  r.id,
  r.item_id,
  r.reported_by,
  r.reason,
  r.status,
  r.created_at,
  i.kind,
  i.ticket_code,
  b.ref_code,
  p.id   as partner_id,
  p.name as partner_name
from booking_message_reports r
join booking_items i on i.id = r.item_id
join bookings b on b.id = r.booking_id
join partners p on p.id = r.partner_id
where is_admin();

alter view admin_message_reports set (security_invoker = on);
revoke all on admin_message_reports from public;
grant select on admin_message_reports to authenticated;

create or replace function admin_resolve_message_report(p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update booking_message_reports set status = 'resolved' where id = p_id;
  if not found then
    return query select false, 'That report no longer exists.'::text; return;
  end if;

  return query select true, 'Marked resolved.'::text;
end $$;

revoke all on function admin_resolve_message_report(uuid) from public;
grant execute on function admin_resolve_message_report(uuid) to authenticated;

select 'message report and block ready' as done;
