-- ===========================================================================
-- Migration 020 — the partner gets told when something happens
--
-- Until now the partner app was pull-only: a booking landed, and the operator
-- found out the next time they happened to open the Bookings tab. Every
-- established partner app (Airbnb, Booking.com, the food-delivery consoles)
-- leads with a feed of "here is what changed since you last looked", because
-- a same-day booking nobody saw is a no-show waiting to happen.
--
-- This is the database half of that: one table, one trigger, one RPC.
--
--   · partner_notifications — the feed. One row per thing worth telling the
--     partner about. Written ONLY by the trigger below (SECURITY DEFINER),
--     never by the app — same "one door" discipline as create_booking().
--
--   · notify_partner_of_booking() — fires off booking_items, the same table
--     sync_availability() (004) already hangs a trigger on. A new item is a
--     "new booking"; an item an admin cancels (cancelled_note gets set, 018)
--     or the weather disrupts is a "this changed and you didn't do it".
--     A partner's OWN decline sets state = 'refunded' with no note, and is
--     deliberately NOT notified — they just did it, they know.
--
--   · mark_partner_notifications_read() — the Notifications screen calls this
--     when the partner opens it. Bulk "all of mine, read now."
--
-- Deliberately out of scope here (later slices): email/SMS/push delivery
-- (no mail provider is wired into the app yet), business- and listing-review
-- notifications (would need a trigger on each of the seven catalogue tables),
-- and realtime push (the app re-reads on navigation, which is enough for v1).
--
-- The notification body stores a REAL date ("Mon 03 Feb · 9:00 AM"), not
-- "Tomorrow" — a relative label frozen into a stored string goes wrong the
-- moment the day rolls over.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The feed.
-- ---------------------------------------------------------------------------

create table if not exists partner_notifications (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  kind        text not null check (kind in
                ('booking_new', 'booking_cancelled', 'booking_disrupted')),
  title       text not null,
  body        text not null,
  -- The booking_items row this is about, so the app can deep-link the
  -- partner straight to it. Nullable and no FK: a notification outlives the
  -- item it describes, and losing the link is better than losing the row.
  item_id     uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Serves the feed read (partner_id = X order by created_at desc), the unread
-- count (partner_id = X and read_at is null — few enough rows that the
-- created_at leg does no harm), and the on delete cascade from partners.
create index if not exists partner_notifications_feed_idx
  on partner_notifications (partner_id, created_at desc);

alter table partner_notifications enable row level security;

-- Read: the partner (owner or staff) sees its own, same partner_users
-- pattern as "partner sees own items" (009). No insert/update/delete policy
-- for anyone — the trigger writes, the RPC marks read, both SECURITY DEFINER.
drop policy if exists "partner sees own notifications" on partner_notifications;
create policy "partner sees own notifications" on partner_notifications
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = partner_notifications.partner_id
        and pu.user_id = auth.uid()
    )
  );

revoke all on partner_notifications from public;
grant select on partner_notifications to authenticated;


-- ---------------------------------------------------------------------------
-- notify_partner_of_booking — the one trigger.
--
-- SECURITY DEFINER so the insert reaches partner_notifications regardless of
-- who tripped it: create_booking() runs as the traveller, admin_cancel_
-- booking() as an admin, and neither holds insert rights on this table.
-- ---------------------------------------------------------------------------

create or replace function notify_partner_of_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_when  text;
  v_party text;
begin
  v_party := case
    when coalesce(new.kind, old.kind) = 'table'
      then 'Table for ' || coalesce(new.party, old.party)
    when coalesce(new.kind, old.kind) = 'ferry'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' adult' else ' adults' end
    when coalesce(new.kind, old.kind) = 'trip'
      then coalesce(new.party, old.party)
           || case when coalesce(new.party, old.party) = 1 then ' seat' else ' seats' end
    else coalesce(new.party, old.party)
         || case when coalesce(new.party, old.party) = 1 then ' guest' else ' guests' end
  end;

  -- A booking just landed on this partner.
  if TG_OP = 'INSERT' then
    v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
    v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      new.partner_id,
      'booking_new',
      case when new.state = 'pending'
        then 'New booking — needs your confirmation'
        else 'New booking' end,
      v_title || ' · ' || v_when || ' · ' || v_party,
      new.id
    );
    return null;
  end if;

  -- An item this partner already had, changed out from under them.
  if TG_OP = 'UPDATE' and old.state is distinct from new.state then
    -- Cancelled by an admin on the partner's behalf. decline_booking() (010)
    -- also lands on 'refunded' but leaves cancelled_note null — that one is
    -- the partner's own doing and stays silent.
    if new.state = 'refunded'
       and new.cancelled_note is not null
       and coalesce(old.cancelled_note, '') is distinct from new.cancelled_note then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_cancelled',
        'Booking cancelled by Andaman Go',
        v_title || ' · ' || v_when || ' — ' || new.cancelled_note,
        new.id
      );

    elsif new.state = 'disrupted' then
      v_title := coalesce(subject_title(new.kind, new.subject_id), 'A booking');
      v_when  := to_char(new.starts_at at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM');
      insert into partner_notifications (partner_id, kind, title, body, item_id)
      values (
        new.partner_id,
        'booking_disrupted',
        'Booking disrupted — weather',
        v_title || ' · ' || v_when || ' · ' || v_party,
        new.id
      );
    end if;

    return null;
  end if;

  return null;
end $$;

drop trigger if exists booking_items_notify_partner on booking_items;
create trigger booking_items_notify_partner
after insert or update on booking_items
for each row execute function notify_partner_of_booking();


-- ---------------------------------------------------------------------------
-- mark_partner_notifications_read — "I've seen these."
--
-- Scoped to the caller's own partner the same way confirm_booking() (010) is:
-- the partner id comes from partner_users, never from the app.
-- ---------------------------------------------------------------------------

create or replace function mark_partner_notifications_read()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partner_notifications
  set read_at = now()
  where partner_id = v_partner and read_at is null;
end $$;

revoke all on function mark_partner_notifications_read() from public;
grant execute on function mark_partner_notifications_read() to authenticated;


-- Check: the table answers.
select count(*) as partner_notifications_rows from partner_notifications;
