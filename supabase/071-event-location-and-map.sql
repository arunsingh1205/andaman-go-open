-- Events grow up: per-listing location, a map pin, and more than four types
-- (2026-09-11).
--
-- 1. events.maps_url — an optional Google Maps link the partner pastes in,
--    same idea as partners.maps_url (045). Nullable; existing rows stay null.
--
-- 2. events.island_slug stops being copied blindly from the partner row. An
--    event company hosts a bonfire in Sri Vijaya Puram one week and a gig on
--    a Swaraj Dweep beach the next — each listing says where IT is. The RPCs
--    take p_island_slug now; a blank still falls back to the partner's island
--    so nothing regresses.
--
-- 3. The genre list was dj / live / bonfire / karaoke since 016 — too narrow
--    for what actually runs here. Adds comedy, drama, festival (the tourism
--    festivals the islands run), carnival, and cruise (a dinner cruise with
--    live music and dance). The events_genre_check constraint and both RPCs'
--    own guards move together.
--    "Who's performing" is now required for comedy and drama too, not just
--    dj / live — a comedy night is booked for the comic, a play for the
--    company. A bonfire, karaoke, festival, carnival, or cruise is the event
--    itself, so it stays optional there.
--
-- add_partner_event / update_partner_event are dropped and recreated (not
-- create-or-replace) since the parameter list changes — same as 053. The
-- owner-only guard from 058 (perform assert_partner_owner) is kept.

alter table events add column if not exists maps_url text;

alter table events drop constraint if exists events_genre_check;
alter table events add constraint events_genre_check
  check (genre in ('dj', 'live', 'bonfire', 'karaoke', 'comedy', 'drama', 'festival', 'carnival', 'cruise'));


-- ---------------------------------------------------------------------------
-- add_partner_event
-- ---------------------------------------------------------------------------

drop function if exists add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text);

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
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null
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

  if p_genre not in ('dj', 'live', 'bonfire', 'karaoke', 'comedy', 'drama', 'festival', 'carnival', 'cruise') then
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
  if p_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text, null::uuid;
    return;
  end if;

  -- Island: the form's choice wins; a blank falls back to the partner's own.
  select island_slug into v_island from partners where id = v_partner;
  if coalesce(trim(p_island_slug), '') <> '' then
    if not exists (select 1 from islands where slug = p_island_slug) then
      return query select false, 'Choose a valid island.'::text, null::uuid;
      return;
    end if;
    v_island := trim(p_island_slug);
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'events');

  insert into events (
    slug, partner_id, island_slug, genre, mark, name, venue, area,
    on_date, time_mins, entry_paise, capacity, rating, reviews, about,
    age_restriction, performer, maps_url, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_genre, v_mark, trim(p_name), trim(p_venue),
    coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    p_on_date, p_time_mins, p_entry_paise, p_capacity, 0, 0, coalesce(trim(p_about), ''),
    p_age_restriction, nullif(trim(p_performer), ''), nullif(trim(p_maps_url), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text, text, text) from public;
grant execute on function
  add_partner_event(text, text, text, text, date, int, int, int, text, text, text, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- update_partner_event
-- ---------------------------------------------------------------------------

drop function if exists update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text);

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
  p_photo_path      text default null,
  p_island_slug     text default null,
  p_maps_url        text default null
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
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  select is_listed, genre into v_was_listed, v_genre
  from events where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if v_genre in ('dj', 'live', 'comedy', 'drama') and coalesce(trim(p_performer), '') = '' then
    return query select false, 'Add who''s performing.'::text;
    return;
  end if;

  update events set
    name = trim(p_name),
    venue = trim(p_venue),
    area = coalesce(nullif(trim(p_area), ''), 'Near the venue'),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
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

revoke all on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, text) from public;
grant execute on function
  update_partner_event(uuid, text, text, text, date, int, int, int, text, text, text, text, text, text)
  to authenticated;


select 'event location, map link, and expanded genres installed' as done;
