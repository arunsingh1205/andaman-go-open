-- Security audit fixes (2026-09-05).
--
-- 1. add_partner_event / update_partner_event (053) and add_partner_trip /
--    update_partner_trip (056) were dropped and recreated to add new columns,
--    and lost the assert_partner_owner() call that 027-owner-only-writes.sql
--    added everywhere else. That let any staff member linked to a partner
--    (not just the owner) add/edit that partner's events and trips. Restored
--    here — signatures are unchanged from 053/056, so create-or-replace is
--    safe (no drop needed).
--
-- 2. unique_slug() is an internal helper other SECURITY DEFINER functions
--    call — it never needed a direct grant to `authenticated`. Revoking it
--    closes off a caller-chosen-table existence oracle (low impact, since
--    it's invoker-rights and bounded by the target table's own RLS, but
--    unnecessary exposure).
--
-- 3. leave_review() validated the rating but never capped body length,
--    unlike send_traveller_message's 2000-char cap. Matched here.
--
-- 4. Neither storage bucket had allowed_mime_types set, so the app's
--    client-side-only file type "validation" (none, in fact) had no
--    server-side backstop. Locked down to what partners actually upload.


-- ===========================================================================
-- 1. Restore owner-only enforcement on events and trips
-- ===========================================================================

create or replace function add_partner_event(
  p_genre           text,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null
) returns table (ok boolean, message text, event_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island  text;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_genre not in ('dj', 'live', 'bonfire', 'karaoke') then
    return query select false, 'Choose a valid event type.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the event a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_venue), '') = '' then
    return query select false, 'Give the event a venue.'::text, null::uuid;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text, null::uuid;
    return;
  end if;
  if p_entry_paise is null or p_entry_paise < 0 then
    return query select false, 'Enter a valid entry price.'::text, null::uuid;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text, null::uuid;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text, null::uuid;
    return;
  end if;
  if p_genre in ('dj', 'live') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, entry_paise, capacity, rating, reviews, about,
    age_restriction, performer, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''),
    p_age_restriction, nullif(trim(p_performer), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

create or replace function update_partner_event(
  p_id              uuid,
  p_name            text,
  p_venue           text,
  p_area            text,
  p_on_date         date,
  p_time_mins       int,
  p_entry_paise     int,
  p_capacity        int,
  p_about           text,
  p_age_restriction text default 'all-ages',
  p_performer       text default null,
  p_photo_path      text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
  v_genre      text;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the event a name.'::text;
    return;
  end if;
  if coalesce(trim(p_venue), '') = '' then
    return query select false, 'Give the event a venue.'::text;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text;
    return;
  end if;
  if p_entry_paise is null or p_entry_paise < 0 then
    return query select false, 'Enter a valid entry price.'::text;
    return;
  end if;
  if p_capacity is null or p_capacity < 1 then
    return query select false, 'Enter a valid capacity.'::text;
    return;
  end if;
  if p_age_restriction not in ('all-ages', '18+', '21+') then
    return query select false, 'Choose a valid age restriction.'::text;
    return;
  end if;

  select is_listed, genre into v_was_listed, v_genre
  from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    on_date = p_on_date,
    time_mins = p_time_mins,
    entry_paise = p_entry_paise,
    capacity = p_capacity,
    about = coalesce(trim(p_about), ''),
    age_restriction = p_age_restriction,
    performer = nullif(trim(p_performer), ''),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

create or replace function add_partner_trip(
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_difficulty text,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_bring_list text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null
) returns table (ok boolean, message text, trip_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_id uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the host a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;
  if p_difficulty not in ('easy', 'moderate', 'challenging') then
    return query select false, 'Choose a valid difficulty.'::text, null::uuid;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text, null::uuid;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Enter a valid minimum seat count.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_slug := unique_slug(p_title, 'trips');

  insert into trips (
    slug, partner_id, island_slug, title, host_name, host_since, duration_label,
    runs_on_days, price_paise, difficulty, min_seats, seats_total, rating, reviews,
    summary, includes, bring_list, meet_point, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, trim(p_title), trim(p_host_name), coalesce(trim(p_host_since), ''),
    coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'), p_price_paise, p_difficulty, p_min_seats, p_seats_total,
    0, 0, coalesce(trim(p_summary), ''), coalesce(p_includes, '{}'), coalesce(p_bring_list, '{}'),
    trim(p_meet_point), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

create or replace function update_partner_trip(
  p_id uuid,
  p_title text,
  p_host_name text,
  p_host_since text,
  p_duration_label text,
  p_runs_on_days int[],
  p_price_paise int,
  p_difficulty text,
  p_min_seats int,
  p_seats_total int,
  p_summary text,
  p_includes text[] default '{}',
  p_bring_list text[] default '{}',
  p_meet_point text default '',
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'Give the trip a title.'::text;
    return;
  end if;
  if coalesce(trim(p_host_name), '') = '' then
    return query select false, 'Give the host a name.'::text;
    return;
  end if;
  if coalesce(trim(p_meet_point), '') = '' then
    return query select false, 'Give a meeting point.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;
  if p_difficulty not in ('easy', 'moderate', 'challenging') then
    return query select false, 'Choose a valid difficulty.'::text;
    return;
  end if;
  if p_seats_total is null or p_seats_total < 1 then
    return query select false, 'Enter a valid seat count.'::text;
    return;
  end if;
  if p_min_seats is null or p_min_seats < 1 or p_min_seats > p_seats_total then
    return query select false, 'Enter a valid minimum seat count.'::text;
    return;
  end if;

  select is_listed into v_was_listed from trips where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update trips set
    title = trim(p_title),
    host_name = trim(p_host_name),
    host_since = coalesce(trim(p_host_since), ''),
    duration_label = coalesce(nullif(trim(p_duration_label), ''), 'Full day'),
    runs_on_days = coalesce(p_runs_on_days, '{0,1,2,3,4,5,6}'),
    price_paise = p_price_paise,
    difficulty = p_difficulty,
    min_seats = p_min_seats,
    seats_total = p_seats_total,
    summary = coalesce(trim(p_summary), ''),
    includes = coalesce(p_includes, '{}'),
    bring_list = coalesce(p_bring_list, '{}'),
    meet_point = trim(p_meet_point),
    photo_path = p_photo_path,
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;


-- ===========================================================================
-- 2. unique_slug is an internal helper — no direct caller needs it
-- ===========================================================================

revoke execute on function unique_slug(text, text) from authenticated;


-- ===========================================================================
-- 3. Cap review body length, same discipline as booking messages
-- ===========================================================================

create or replace function leave_review(p_item_id uuid, p_rating int, p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_booking  uuid;
  v_partner  uuid;
  v_kind     text;
  v_subject  uuid;
  v_redeemed timestamptz;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'Pick a rating from 1 to 5.'::text;
    return;
  end if;

  if p_body is not null and length(p_body) > 2000 then
    return query select false, 'Keep your review under 2000 characters.'::text;
    return;
  end if;

  select i.booking_id, i.partner_id, i.kind, i.subject_id, i.redeemed_at
    into v_booking, v_partner, v_kind, v_subject, v_redeemed
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_kind = 'ferry' then
    return query select false, 'Ferry crossings can''t be reviewed.'::text;
    return;
  end if;

  if v_redeemed is null then
    return query select false, 'You can review this once the operator has checked you in.'::text;
    return;
  end if;

  insert into reviews (item_id, booking_id, user_id, partner_id, kind, subject_id, rating, body)
  values (p_item_id, v_booking, v_user, v_partner, v_kind, v_subject, p_rating,
          nullif(trim(p_body), ''))
  on conflict (item_id) do update set
    rating     = excluded.rating,
    body       = excluded.body,
    created_at = now();

  return query select true, 'Thanks — your review is in.'::text;
end $$;


-- ===========================================================================
-- 4. Lock partner storage buckets down to the file types the app actually
--    generates <input> pickers for (photo pickers, plus PDF for licenses)
-- ===========================================================================

update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'partner-photos';

update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  where id = 'partner-licenses';


select 'security audit fixes applied' as done;
