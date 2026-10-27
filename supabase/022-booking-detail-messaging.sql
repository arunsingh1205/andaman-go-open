-- ===========================================================================
-- Migration 022 — the booking detail page, and a message thread on it
--
-- Until now a partner saw each booking as one card in a list and a traveller
-- saw the same, and the only way they could talk was the phone number printed
-- on it. Every established booking app (Airbnb, Booking.com, the food consoles)
-- puts a message thread on the booking itself — it's what keeps a "running
-- 20 minutes late" or "can we move to the 2 PM?" on the platform instead of
-- in a WhatsApp nobody can see later.
--
-- Three things here:
--
--   1. booking_items.confirmed_at — so the detail page can draw a real
--      timeline (booked -> confirmed -> checked in) instead of guessing from
--      state. Only confirm_booking() stamps it; an auto-confirmed booking
--      leaves it null and the UI reads that as "confirmed on the spot".
--
--   2. booking_messages — one thread per booking_item (the unit both apps
--      already treat as "one thing to run"). Written only through the two
--      send RPCs, each of which checks the caller owns its own side.
--
--   3. A traveller's message raises a partner_notification (kind
--      'booking_message', new) so it rings the bell added in 020. The other
--      direction has no traveller notification system yet — the unread count
--      on their own booking is the signal, and that's a later slice.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. When a pending booking was accepted.
-- ---------------------------------------------------------------------------

alter table booking_items add column if not exists confirmed_at timestamptz;


-- confirm_booking() — migration 010's body, unchanged except the one marked
-- line. create_replace needs the whole function.
create or replace function confirm_booking(p_item_id uuid)
returns table (ok boolean, message text, ticket_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_kind    text;
  v_state   text;
  v_ref     text;
  v_ticket  text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.kind, i.state, b.ref_code into v_kind, v_state, v_ref
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_ref is null then
    return query select false, 'Booking not found.'::text, null::text;
    return;
  end if;

  if v_state <> 'pending' then
    return query select false, 'This booking is not waiting on you anymore.'::text, null::text;
    return;
  end if;

  v_ticket := v_ref || '-' || upper(left(v_kind, 1));

  update booking_items
  set state = 'confirmed', ticket_code = v_ticket, confirmed_at = now()  -- 022: confirmed_at
  where id = p_item_id;

  return query select true, 'Confirmed.'::text, v_ticket;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The thread.
-- ---------------------------------------------------------------------------

create table if not exists booking_messages (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references booking_items(id) on delete cascade,
  -- Denormalised from the item so the RLS policies and the traveller-side
  -- read don't have to join back through booking_items every time.
  booking_id  uuid not null references bookings(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  sender      text not null check (sender in ('partner', 'traveller')),
  body        text not null,
  -- Set when the OTHER side has seen it.
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists booking_messages_thread_idx
  on booking_messages (item_id, created_at);
create index if not exists booking_messages_partner_idx
  on booking_messages (partner_id);
create index if not exists booking_messages_booking_idx
  on booking_messages (booking_id);

alter table booking_messages enable row level security;

-- Two permissive select policies, OR'd: the partner side of the thread, and
-- the traveller side. No insert/update/delete for anyone — every write goes
-- through a SECURITY DEFINER RPC below.
drop policy if exists "partner reads its thread" on booking_messages;
create policy "partner reads its thread" on booking_messages
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = booking_messages.partner_id
        and pu.user_id = auth.uid()
    )
  );

drop policy if exists "traveller reads its booking thread" on booking_messages;
create policy "traveller reads its booking thread" on booking_messages
  for select using (
    exists (
      select 1 from bookings b
      where b.id = booking_messages.booking_id
        and b.user_id = auth.uid()
    )
  );

revoke all on booking_messages from public;
grant select on booking_messages to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Sending — one RPC per side, each checks its own ownership.
-- ---------------------------------------------------------------------------

create or replace function partner_send_message(p_item_id uuid, p_body text)
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

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id into v_booking
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'partner', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;

revoke all on function partner_send_message(uuid, text) from public;
grant execute on function partner_send_message(uuid, text) to authenticated;


create or replace function traveller_send_message(p_item_id uuid, p_body text)
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

  if coalesce(trim(p_body), '') = '' then
    return query select false, 'Type a message first.'::text;
    return;
  end if;
  if length(p_body) > 2000 then
    return query select false, 'That message is too long — keep it under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id, i.partner_id into v_booking, v_partner
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  insert into booking_messages (item_id, booking_id, partner_id, sender, body)
  values (p_item_id, v_booking, v_partner, 'traveller', trim(p_body));

  return query select true, 'Sent.'::text;
end $$;

revoke all on function traveller_send_message(uuid, text) from public;
grant execute on function traveller_send_message(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Marking a thread read — the side reading it clears the OTHER side's
-- unread messages.
-- ---------------------------------------------------------------------------

create or replace function mark_booking_messages_read(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (
    select 1 from booking_items where id = p_item_id and partner_id = v_partner
  ) then
    return;
  end if;

  update booking_messages
  set read_at = now()
  where item_id = p_item_id and sender = 'traveller' and read_at is null;

  -- Opening the thread also counts as seeing its bell notifications.
  update partner_notifications
  set read_at = now()
  where partner_id = v_partner
    and item_id = p_item_id
    and kind = 'booking_message'
    and read_at is null;
end $$;

revoke all on function mark_booking_messages_read(uuid) from public;
grant execute on function mark_booking_messages_read(uuid) to authenticated;


create or replace function mark_traveller_messages_read(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update booking_messages m
  set read_at = now()
  where m.item_id = p_item_id
    and m.sender = 'partner'
    and m.read_at is null
    and exists (
      select 1 from booking_items i
      join bookings b on b.id = i.booking_id
      where i.id = m.item_id and b.user_id = v_user
    );
end $$;

revoke all on function mark_traveller_messages_read(uuid) from public;
grant execute on function mark_traveller_messages_read(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. A traveller's message rings the partner's bell (020).
-- ---------------------------------------------------------------------------

alter table partner_notifications drop constraint if exists partner_notifications_kind_check;
alter table partner_notifications add constraint partner_notifications_kind_check
  check (kind in ('booking_new', 'booking_cancelled', 'booking_disrupted', 'booking_message'));

create or replace function notify_partner_of_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if new.sender <> 'traveller' then
    return null;
  end if;

  select coalesce(subject_title(i.kind, i.subject_id), 'A booking')
  into v_title
  from booking_items i where i.id = new.item_id;

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'booking_message',
    'New message from a traveller',
    coalesce(v_title, 'A booking') || ' — ' ||
      case when length(new.body) > 90 then left(new.body, 90) || '…' else new.body end,
    new.item_id
  );

  return null;
end $$;

drop trigger if exists booking_messages_notify_partner on booking_messages;
create trigger booking_messages_notify_partner
after insert on booking_messages
for each row execute function notify_partner_of_message();


-- ---------------------------------------------------------------------------
-- The views gain the timeline stamps and an unread count. CREATE OR REPLACE
-- VIEW can only APPEND columns, so all four land at the end of each select.
-- ---------------------------------------------------------------------------

create or replace view partner_bookings as
select
  i.id as item_id,
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  b.contact_phone,
  b.contact_email,
  i.cancelled_note,
  i.confirmed_at,
  b.created_at as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'traveller' and m.read_at is null
  ) as unread_from_traveller
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);
revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;


create or replace view my_bookings as
select
  i.id                                as item_id,
  b.id                                as booking_id,
  b.ref_code,
  b.on_date,
  b.island_slug,
  isl.name                            as island_name,
  i.kind,
  i.subject_id,
  subject_title(i.kind, i.subject_id) as title,
  partner_name(i.partner_id)          as operator,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  partner_maps_url(i.partner_id)      as maps_url,
  partner_address(i.partner_id)       as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


-- Check: the thread table answers.
select count(*) as booking_messages_rows from booking_messages;
