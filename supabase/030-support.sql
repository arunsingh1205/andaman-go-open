-- ===========================================================================
-- Migration 030 — a way to reach Andaman Go
--
-- A partner with a problem — a booking that went wrong, a payout question, a
-- listing stuck in review — has had nowhere to go. This is the channel: one
-- ongoing conversation per business, the partner on one side and whoever is
-- on the admin console on the other. Same shape as the booking message
-- thread (022), just between a partner and Andaman Go instead of a partner
-- and a traveller.
--
-- Both owner and staff can use it — a staff member on the door hits problems
-- too.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- One thread per business, carrying only the triage status.
-- ---------------------------------------------------------------------------

create table if not exists support_threads (
  partner_id uuid primary key references partners(id) on delete cascade,
  status     text not null default 'open' check (status in ('open', 'resolved')),
  updated_at timestamptz not null default now()
);

create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  sender      text not null check (sender in ('partner', 'admin')),
  body        text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_thread_idx
  on support_messages (partner_id, created_at);

alter table support_threads enable row level security;
alter table support_messages enable row level security;

drop policy if exists "partner reads own support thread" on support_threads;
create policy "partner reads own support thread" on support_threads
  for select using (
    is_admin()
    or exists (
      select 1 from partner_users pu
      where pu.partner_id = support_threads.partner_id and pu.user_id = auth.uid()
    )
  );

drop policy if exists "partner reads own support messages" on support_messages;
create policy "partner reads own support messages" on support_messages
  for select using (
    is_admin()
    or exists (
      select 1 from partner_users pu
      where pu.partner_id = support_messages.partner_id and pu.user_id = auth.uid()
    )
  );

grant select on support_threads to authenticated;
grant select on support_messages to authenticated;


-- ---------------------------------------------------------------------------
-- Sending — one RPC per side.
-- ---------------------------------------------------------------------------

create or replace function send_support_message(p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 4000 then
    return query select false, 'That message is too long.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (v_partner, 'open', now())
  on conflict (partner_id) do update set status = 'open', updated_at = now();

  insert into support_messages (partner_id, sender, body)
  values (v_partner, 'partner', trim(p_body));

  return query select true, 'Sent. Andaman Go will get back to you here.'::text;
end $$;

revoke all on function send_support_message(text) from public;
grant execute on function send_support_message(text) to authenticated;


create or replace function admin_reply_support(p_partner_id uuid, p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a reply first.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (p_partner_id, 'open', now())
  on conflict (partner_id) do update set updated_at = now();

  insert into support_messages (partner_id, sender, body)
  values (p_partner_id, 'admin', trim(p_body));

  return query select true, 'Reply sent.'::text;
end $$;

revoke all on function admin_reply_support(uuid, text) from public;
grant execute on function admin_reply_support(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Marking read, and closing a thread.
-- ---------------------------------------------------------------------------

create or replace function mark_support_read()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    return;
  end if;

  update support_messages
  set read_at = now()
  where partner_id = v_partner and sender = 'admin' and read_at is null;

  update partner_notifications
  set read_at = now()
  where partner_id = v_partner and kind = 'support' and read_at is null;
end $$;

revoke all on function mark_support_read() from public;
grant execute on function mark_support_read() to authenticated;


create or replace function admin_mark_support_read(p_partner_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update support_messages
  set read_at = now()
  where partner_id = p_partner_id and sender = 'partner' and read_at is null;
end $$;

revoke all on function admin_mark_support_read(uuid) from public;
grant execute on function admin_mark_support_read(uuid) to authenticated;


create or replace function admin_set_support_status(p_partner_id uuid, p_status text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_status not in ('open', 'resolved') then
    return query select false, 'Unknown status.'::text;
    return;
  end if;

  insert into support_threads (partner_id, status, updated_at)
  values (p_partner_id, p_status, now())
  on conflict (partner_id) do update set status = p_status, updated_at = now();

  return query select true, 'Updated.'::text;
end $$;

revoke all on function admin_set_support_status(uuid, text) from public;
grant execute on function admin_set_support_status(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- An admin reply rings the partner's bell (020). Always on — no pref.
-- ---------------------------------------------------------------------------

alter table partner_notifications drop constraint if exists partner_notifications_kind_check;
alter table partner_notifications add constraint partner_notifications_kind_check
  check (kind in ('booking_new', 'booking_cancelled', 'booking_disrupted',
                  'booking_message', 'review', 'support'));

create or replace function notify_partner_of_support() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender <> 'admin' then
    return null;
  end if;

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'support',
    'Andaman Go replied',
    case when length(new.body) > 100 then left(new.body, 100) || '…' else new.body end,
    null
  );

  return null;
end $$;

drop trigger if exists support_messages_notify_partner on support_messages;
create trigger support_messages_notify_partner
after insert on support_messages
for each row execute function notify_partner_of_support();


-- ---------------------------------------------------------------------------
-- The admin inbox: one row per thread, newest activity first.
-- ---------------------------------------------------------------------------

create or replace view admin_support_threads as
select
  st.partner_id,
  p.name          as partner_name,
  st.status,
  st.updated_at,
  (
    select count(*) from support_messages m
    where m.partner_id = st.partner_id and m.sender = 'partner' and m.read_at is null
  ) as partner_unread,
  (
    select m.body from support_messages m
    where m.partner_id = st.partner_id order by m.created_at desc limit 1
  ) as last_body,
  (
    select m.sender from support_messages m
    where m.partner_id = st.partner_id order by m.created_at desc limit 1
  ) as last_sender
from support_threads st
join partners p on p.id = st.partner_id
where is_admin();

alter view admin_support_threads set (security_invoker = on);
revoke all on admin_support_threads from public;
grant select on admin_support_threads to authenticated;


-- Check: the threads table answers.
select count(*) as support_threads_rows from support_threads;
