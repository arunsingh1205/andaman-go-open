-- ===========================================================================
-- Migration 072 — Community Service: free, organiser-run activities
--
-- Beach cleanups, volunteer days, NGO drives — free activities a local
-- community or NGO runs. None of this fits the paid catalogue:
-- there is no price, no recurring timetable, no seat that create_booking holds
-- and no Razorpay charge. It is one dated gathering with an organiser brief
-- (meeting point, what to bring, safety notes, age limits, a primary contact,
-- a WhatsApp group) and a free "I'm interested" sign-up that records the
-- details an organiser needs to run it safely.
--
-- So it gets its own two tables, modelled on `events` (one-off, dated) plus
-- `activity_guests` (068) for the sign-up shape:
--   * community_services — the listing. is_listed = false on insert, same
--     review gate as every other catalogue kind.
--   * community_signups   — one row per interested person, written only through
--     the community_signup() RPC (anon session, no login — same identity model
--     as a booking).
--
-- Also extends the four admin/resubmit RPCs (bodies carried over from 049) with
-- a 'community' branch.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists community_services (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  partner_id         uuid not null references partners(id) on delete cascade,
  island_slug        text not null references islands(slug),
  mark               text not null,                 -- the two letters on the list tile
  name               text not null,
  organizer_name     text not null,                 -- the NGO / group actually running it
  about              text not null default '',
  on_date            date not null,
  time_mins          int  not null check (time_mins between 0 and 1439),
  maps_url           text,                           -- exact Google Maps pin
  meeting_point      text not null,
  what_to_bring      text,
  safety_notes       text,
  min_age            int check (min_age is null or min_age between 0 and 120),
  max_age            int check (max_age is null or max_age between 0 and 120),
  contact_name       text not null,
  contact_phone      text not null,
  whatsapp_group_url text,                           -- organiser's group invite link
  is_listed          boolean not null default false,
  rejection_reason   text,
  created_at         timestamptz not null default now()
);

create index if not exists community_services_date_idx
  on community_services (island_slug, on_date, is_listed);


create table if not exists community_signups (
  id                       uuid primary key default gen_random_uuid(),
  community_service_id     uuid not null references community_services(id) on delete cascade,
  user_id                  uuid not null default auth.uid(),
  full_name                text not null,
  age                      int check (age is null or age between 0 and 120),
  date_of_birth            date,
  phone                    text not null,
  emergency_contact_name   text not null,
  emergency_contact_phone  text not null,
  consent                  boolean not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (community_service_id, user_id)
);

create index if not exists community_signups_service_idx
  on community_signups (community_service_id);


-- ---------------------------------------------------------------------------
-- 2. Row level security
--
-- community_services: exactly as public as an activity/restaurant — is_listed
-- AND the business approved. A partner sees their own in any state; an admin
-- sees everything.
--
-- community_signups: no insert/update policy at all — the only writer is the
-- SECURITY DEFINER RPC below. A person sees their own rows; the organiser sees
-- the sign-ups for their own listings (so they can add people to the group);
-- an admin sees everything.
-- ---------------------------------------------------------------------------

alter table community_services enable row level security;
alter table community_signups  enable row level security;

drop policy if exists "listed community services are public" on community_services;
create policy "listed community services are public" on community_services
  for select using (
    is_listed and exists (
      select 1 from partners p where p.id = partner_id and p.status = 'approved'
    )
  );

drop policy if exists "partner sees own community services" on community_services;
create policy "partner sees own community services" on community_services
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid() and pu.partner_id = community_services.partner_id
    )
  );

drop policy if exists "admins see all community services" on community_services;
create policy "admins see all community services" on community_services
  for select using (is_admin());

drop policy if exists "own community signups" on community_signups;
create policy "own community signups" on community_signups
  for select using (user_id = auth.uid());

drop policy if exists "partner sees own community signups" on community_signups;
create policy "partner sees own community signups" on community_signups
  for select using (
    exists (
      select 1
      from community_services cs
      join partner_users pu on pu.partner_id = cs.partner_id
      where cs.id = community_signups.community_service_id
        and pu.user_id = auth.uid()
    )
  );

drop policy if exists "admins see all community signups" on community_signups;
create policy "admins see all community signups" on community_signups
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 3. add_partner_community_service — same shape as add_partner_event
--    (071-event-location-and-map.sql): owner-only, look up the caller's own
--    partner_id, insert with is_listed = false. The form's island wins; a
--    blank falls back to the partner's own.
-- ---------------------------------------------------------------------------

create or replace function add_partner_community_service(
  p_name               text,
  p_organizer_name     text,
  p_about              text,
  p_on_date            date,
  p_time_mins          int,
  p_island_slug        text default null,
  p_maps_url           text default null,
  p_meeting_point      text default '',
  p_what_to_bring      text default null,
  p_safety_notes       text default null,
  p_min_age            int  default null,
  p_max_age            int  default null,
  p_contact_name       text default '',
  p_contact_phone      text default '',
  p_whatsapp_group_url text default null
) returns table (ok boolean, message text, community_service_id uuid)
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

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_organizer_name), '') = '' then
    return query select false, 'Add the organiser or NGO name.'::text, null::uuid;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text, null::uuid;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a start time.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_meeting_point), '') = '' then
    return query select false, 'Add a meeting point.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    return query select false, 'Add a primary contact — a name and a phone number.'::text, null::uuid;
    return;
  end if;
  if p_min_age is not null and p_min_age not between 0 and 120 then
    return query select false, 'Enter a valid minimum age.'::text, null::uuid;
    return;
  end if;
  if p_max_age is not null and p_max_age not between 0 and 120 then
    return query select false, 'Enter a valid maximum age.'::text, null::uuid;
    return;
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then
    return query select false, 'The maximum age can''t be below the minimum.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  if coalesce(trim(p_island_slug), '') <> '' then
    if not exists (select 1 from islands where slug = p_island_slug) then
      return query select false, 'Choose a valid island.'::text, null::uuid;
      return;
    end if;
    v_island := trim(p_island_slug);
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'community_services');

  insert into community_services (
    slug, partner_id, island_slug, mark, name, organizer_name, about,
    on_date, time_mins, maps_url, meeting_point, what_to_bring, safety_notes,
    min_age, max_age, contact_name, contact_phone, whatsapp_group_url, is_listed
  ) values (
    v_slug, v_partner, v_island, v_mark, trim(p_name), trim(p_organizer_name),
    coalesce(trim(p_about), ''), p_on_date, p_time_mins,
    nullif(trim(p_maps_url), ''), trim(p_meeting_point),
    nullif(trim(p_what_to_bring), ''), nullif(trim(p_safety_notes), ''),
    p_min_age, p_max_age, trim(p_contact_name), trim(p_contact_phone),
    nullif(trim(p_whatsapp_group_url), ''), false
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_community_service(
  text, text, text, date, int, text, text, text, text, text, int, int, text, text, text
) from public;
grant execute on function add_partner_community_service(
  text, text, text, date, int, text, text, text, text, text, int, int, text, text, text
) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. update_partner_community_service — same discipline as update_partner_event:
--    ownership-checked; editing a LIVE listing sends it back to review.
-- ---------------------------------------------------------------------------

create or replace function update_partner_community_service(
  p_id                 uuid,
  p_name               text,
  p_organizer_name     text,
  p_about              text,
  p_on_date            date,
  p_time_mins          int,
  p_island_slug        text default null,
  p_maps_url           text default null,
  p_meeting_point      text default '',
  p_what_to_bring      text default null,
  p_safety_notes       text default null,
  p_min_age            int  default null,
  p_max_age            int  default null,
  p_contact_name       text default '',
  p_contact_phone      text default '',
  p_whatsapp_group_url text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text;
    return;
  end if;
  if coalesce(trim(p_organizer_name), '') = '' then
    return query select false, 'Add the organiser or NGO name.'::text;
    return;
  end if;
  if p_on_date is null then
    return query select false, 'Choose a date.'::text;
    return;
  end if;
  if p_time_mins is null or p_time_mins not between 0 and 1439 then
    return query select false, 'Choose a start time.'::text;
    return;
  end if;
  if coalesce(trim(p_meeting_point), '') = '' then
    return query select false, 'Add a meeting point.'::text;
    return;
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    return query select false, 'Add a primary contact — a name and a phone number.'::text;
    return;
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then
    return query select false, 'The maximum age can''t be below the minimum.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  select is_listed into v_was_listed
  from community_services where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update community_services set
    name = trim(p_name),
    organizer_name = trim(p_organizer_name),
    about = coalesce(trim(p_about), ''),
    on_date = p_on_date,
    time_mins = p_time_mins,
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    maps_url = nullif(trim(p_maps_url), ''),
    meeting_point = trim(p_meeting_point),
    what_to_bring = nullif(trim(p_what_to_bring), ''),
    safety_notes = nullif(trim(p_safety_notes), ''),
    min_age = p_min_age,
    max_age = p_max_age,
    contact_name = trim(p_contact_name),
    contact_phone = trim(p_contact_phone),
    whatsapp_group_url = nullif(trim(p_whatsapp_group_url), ''),
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end;
$$;

revoke all on function update_partner_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text
) from public;
grant execute on function update_partner_community_service(
  uuid, text, text, text, date, int, text, text, text, text, text, int, int, text, text, text
) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. community_signup — the free "I'm interested" write.
--
-- No login: the app hands every visitor an anonymous auth session (see
-- lib/supabase-browser.ts), exactly as it does before a booking, so auth.uid()
-- is always set here. SECURITY DEFINER so it can write past the RLS that
-- otherwise only lets people READ their own row. One row per (listing, session)
-- — a second submit updates the first. Returns the organiser's WhatsApp group
-- link so the confirmation screen can show the "join" button.
-- ---------------------------------------------------------------------------

create or replace function community_signup(
  p_slug                    text,
  p_full_name               text,
  p_age                     int,
  p_date_of_birth           date,
  p_phone                   text,
  p_emergency_contact_name  text,
  p_emergency_contact_phone text,
  p_consent                 boolean
) returns table (ok boolean, message text, whatsapp_group_url text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_service community_services%rowtype;
  v_age     int;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select cs.* into v_service
  from community_services cs
  join partners p on p.id = cs.partner_id
  where cs.slug = p_slug and cs.is_listed and p.status = 'approved';

  if not found then
    return query select false, 'That activity is no longer listed.'::text, null::text;
    return;
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    return query select false, 'Add your name.'::text, null::text;
    return;
  end if;
  if coalesce(trim(p_phone), '') = '' then
    return query select false, 'Add a phone or WhatsApp number.'::text, null::text;
    return;
  end if;
  if coalesce(trim(p_emergency_contact_name), '') = ''
     or coalesce(trim(p_emergency_contact_phone), '') = '' then
    return query select false, 'Add an emergency contact — a name and a number.'::text, null::text;
    return;
  end if;
  if p_age is null and p_date_of_birth is null then
    return query select false, 'Add your age or date of birth.'::text, null::text;
    return;
  end if;
  if coalesce(p_consent, false) is not true then
    return query select false, 'Please tick the consent box to sign up.'::text, null::text;
    return;
  end if;

  v_age := coalesce(
    p_age,
    date_part('year', age(v_service.on_date, p_date_of_birth))::int
  );
  if v_age is not null and (v_age < 0 or v_age > 120) then
    return query select false, 'Enter a valid age.'::text, null::text;
    return;
  end if;
  if v_service.min_age is not null and v_age < v_service.min_age then
    return query select false,
      format('This activity is for ages %s and up.', v_service.min_age)::text, null::text;
    return;
  end if;
  if v_service.max_age is not null and v_age > v_service.max_age then
    return query select false,
      format('This activity is for ages %s and under.', v_service.max_age)::text, null::text;
    return;
  end if;

  insert into community_signups (
    community_service_id, user_id, full_name, age, date_of_birth, phone,
    emergency_contact_name, emergency_contact_phone, consent, updated_at
  ) values (
    v_service.id, v_uid, trim(p_full_name), p_age, p_date_of_birth, trim(p_phone),
    trim(p_emergency_contact_name), trim(p_emergency_contact_phone), true, now()
  )
  on conflict (community_service_id, user_id) do update set
    full_name = excluded.full_name,
    age = excluded.age,
    date_of_birth = excluded.date_of_birth,
    phone = excluded.phone,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    consent = true,
    updated_at = now();

  return query select true, 'You''re in.'::text, v_service.whatsapp_group_url;
end;
$$;

revoke all on function community_signup(text, text, int, date, text, text, text, boolean) from public;
grant execute on function community_signup(text, text, int, date, text, text, text, boolean)
  to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Admin approve / reject / unlist / resubmit — a 'community' branch each.
--    Bodies carried over from 049-cab-service-rpcs.sql. create or replace keeps
--    the signatures, so nothing that already calls these changes.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_listing(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind = 'activity' and not exists (select 1 from activity_schedule where activity_id = p_id) then
    return query select false, 'Add at least one time slot before approving this activity.'::text;
    return;
  end if;
  if p_kind = 'table' and not exists (select 1 from restaurant_tables where restaurant_id = p_id) then
    return query select false, 'Add at least one table sitting before approving this restaurant.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Approved.'::text;
end $$;

create or replace function admin_reject_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before rejecting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Rejected.'::text;
end $$;

create or replace function admin_unlist_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before unlisting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, rejection_reason = trim(p_reason) where id = p_id and is_listed;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing is not live right now.'::text;
    return;
  end if;

  return query select true, 'Taken down.'::text;
end $$;

revoke all on function admin_unlist_listing(text, uuid, text) from public;
grant execute on function admin_unlist_listing(text, uuid, text) to authenticated;

-- 027 wrapped resubmit_partner_listing in an owner check that calls
-- resubmit_partner_listing_impl — the community branch goes in the _impl body.
create or replace function resubmit_partner_listing_impl(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_hit boolean := false;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_kind = 'activity' then
    update activities set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set rejection_reason = null
      where id = p_id and partner_id = v_partner and rejection_reason is not null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'Nothing to resubmit.'::text;
    return;
  end if;

  return query select true, 'Sent back to Andaman Go for another look.'::text;
end $$;

revoke all on function resubmit_partner_listing_impl(text, uuid) from public, anon, authenticated;


select 'community service installed' as done;
