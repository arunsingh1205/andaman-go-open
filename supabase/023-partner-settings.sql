-- ===========================================================================
-- Migration 023 — partner settings: notification preferences, editable phone
--
-- 020 gave the partner a notification bell but no say in what rings it. This
-- adds that say — three switches (new bookings, cancellations, messages) that
-- the 020/022 triggers now check before writing a row. A partner with no
-- prefs row keeps every notification: absence means "yes", so the feature is
-- inert until someone actually turns something off.
--
-- Also: the business contact number, settable at registration (011) and
-- editable nowhere since, gets its own small RPC — same digit-cleaning as
-- set_my_phone (007).
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The switches.
-- ---------------------------------------------------------------------------

create table if not exists partner_notification_prefs (
  partner_id           uuid primary key references partners(id) on delete cascade,
  notify_new_booking   boolean not null default true,
  notify_cancellation  boolean not null default true,
  notify_message       boolean not null default true,
  updated_at           timestamptz not null default now()
);

alter table partner_notification_prefs enable row level security;

drop policy if exists "partner sees own prefs" on partner_notification_prefs;
create policy "partner sees own prefs" on partner_notification_prefs
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = partner_notification_prefs.partner_id
        and pu.user_id = auth.uid()
    )
  );

revoke all on partner_notification_prefs from public;
grant select on partner_notification_prefs to authenticated;


-- Absence of a row means "notify me" — so this resolves a missing row to
-- true rather than null. SECURITY DEFINER because the triggers that call it
-- run as the traveller / admin who tripped them, not the partner.
create or replace function partner_wants_notification(p_partner_id uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'booking_new' then
      coalesce((select notify_new_booking from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_cancelled' then
      coalesce((select notify_cancellation from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_disrupted' then
      coalesce((select notify_cancellation from partner_notification_prefs where partner_id = p_partner_id), true)
    when 'booking_message' then
      coalesce((select notify_message from partner_notification_prefs where partner_id = p_partner_id), true)
    else true
  end
$$;

revoke all on function partner_wants_notification(uuid, text) from public;
grant execute on function partner_wants_notification(uuid, text) to authenticated;


create or replace function set_partner_notification_prefs(
  p_new_booking boolean,
  p_cancellation boolean,
  p_message boolean
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  insert into partner_notification_prefs
    (partner_id, notify_new_booking, notify_cancellation, notify_message, updated_at)
  values
    (v_partner, coalesce(p_new_booking, true), coalesce(p_cancellation, true),
     coalesce(p_message, true), now())
  on conflict (partner_id) do update set
    notify_new_booking  = excluded.notify_new_booking,
    notify_cancellation = excluded.notify_cancellation,
    notify_message      = excluded.notify_message,
    updated_at          = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_notification_prefs(boolean, boolean, boolean) from public;
grant execute on function set_partner_notification_prefs(boolean, boolean, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- The business contact number.
-- ---------------------------------------------------------------------------

create or replace function set_partner_contact_phone(p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_clean   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  -- Same cleaning as set_my_phone (007): keep digits and a leading +, assume
  -- India when there's no country code.
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set contact_phone = nullif(v_clean, '') where id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_contact_phone(text) from public;
grant execute on function set_partner_contact_phone(text) to authenticated;


-- ---------------------------------------------------------------------------
-- The two trigger functions, re-stated with a preference gate. Bodies are
-- 020's and 022's unchanged except the `if partner_wants_notification(...)`
-- wrappers — create_replace needs the whole function.
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

  if TG_OP = 'INSERT' then
    if partner_wants_notification(new.partner_id, 'booking_new') then
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
    end if;
    return null;
  end if;

  if TG_OP = 'UPDATE' and old.state is distinct from new.state then
    if new.state = 'refunded'
       and new.cancelled_note is not null
       and coalesce(old.cancelled_note, '') is distinct from new.cancelled_note
       and partner_wants_notification(new.partner_id, 'booking_cancelled') then
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

    elsif new.state = 'disrupted'
       and partner_wants_notification(new.partner_id, 'booking_disrupted') then
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


create or replace function notify_partner_of_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if new.sender <> 'traveller' then
    return null;
  end if;

  if not partner_wants_notification(new.partner_id, 'booking_message') then
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


-- Check: the prefs table answers.
select count(*) as partner_notification_prefs_rows from partner_notification_prefs;
