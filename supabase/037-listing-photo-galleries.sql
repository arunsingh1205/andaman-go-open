-- ===========================================================================
-- Migration 037 — listing photo galleries
--
-- 011 and 016 gave every catalogue kind a single optional `photo_path`, and
-- even that never reached the traveller side — lib/activities.ts and friends
-- don't select it, so a scuba dive still shows a coloured square with two
-- letters. A traveller picks a dive, a homestay or a beach shack on photos.
--
-- This migration lets a partner attach SEVERAL photos to a listing, in an
-- order they choose (photo 0 is the cover). One new table holds them for all
-- seven kinds, keyed the same way booking_items keys a subject: a `kind`
-- string plus the row id, deliberately not a foreign key (seven nullable
-- columns would be worse, and the kind tells you the table).
--
-- WRITES. Rather than widen the 28 add_partner_* / update_partner_* functions
-- 027 split into _impl bodies + owner-check wrappers, there is one new RPC —
-- set_listing_photos — and the lib layer calls it right after the add/update,
-- exactly as addPartnerVehicle already calls set_vehicle_security_deposit as
-- a second step. Editing photos on a live listing still sends it back for
-- review, because the edit screen always calls update_partner_* too, and that
-- is what bounces a live listing to pending.
--
-- The old `photo_path` column stays, kept in sync with photo 0, so the admin
-- queue and the my_bookings view keep working untouched. A later migration
-- drops it once nothing reads it.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

create table if not exists listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_kind text not null check (listing_kind in
                 ('activity','rental','stay','table','event','trip','ferry')),
  listing_id   uuid not null,
  storage_path text not null,           -- path in the public partner-photos bucket
  sort_order   int  not null default 0, -- 0 = cover
  created_at   timestamptz not null default now(),
  unique (listing_kind, listing_id, storage_path)
);

create index if not exists listing_photos_lookup
  on listing_photos (listing_kind, listing_id, sort_order);


-- ---------------------------------------------------------------------------
-- 2. The kind -> table map, in one place (mirrors 011's unique_slug).
--
--   listing_partner_id  — who owns this listing, or null if it's gone.
--   listing_is_public   — is_listed AND the business is approved.
-- ---------------------------------------------------------------------------

create or replace function listing_partner_id(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_kind
    when 'activity' then select partner_id into v from activities  where id = p_id;
    when 'rental'   then select partner_id into v from vehicles    where id = p_id;
    when 'stay'     then select partner_id into v from stays       where id = p_id;
    when 'table'    then select partner_id into v from restaurants where id = p_id;
    when 'event'    then select partner_id into v from events      where id = p_id;
    when 'trip'     then select partner_id into v from trips       where id = p_id;
    when 'ferry'    then select partner_id into v from sailings    where id = p_id;
    else v := null;
  end case;
  return v;
end $$;

-- Granted to anon as well as authenticated: an anonymous SELECT on
-- listing_photos evaluates every permissive policy on the table, including the
-- "partner sees own" one that calls this, so anon needs EXECUTE even though
-- that branch never returns true for it.
revoke all on function listing_partner_id(text, uuid) from public;
grant execute on function listing_partner_id(text, uuid) to anon, authenticated;

create or replace function listing_is_public(p_kind text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  case p_kind
    when 'activity' then select x.is_listed and p.status = 'approved' into v
      from activities x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'rental' then select x.is_listed and p.status = 'approved' into v
      from vehicles x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'stay' then select x.is_listed and p.status = 'approved' into v
      from stays x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'table' then select x.is_listed and p.status = 'approved' into v
      from restaurants x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'event' then select x.is_listed and p.status = 'approved' into v
      from events x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'trip' then select x.is_listed and p.status = 'approved' into v
      from trips x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'ferry' then select x.is_listed and p.status = 'approved' into v
      from sailings x join partners p on p.id = x.partner_id where x.id = p_id;
    else v := false;
  end case;
  return coalesce(v, false);
end $$;

revoke all on function listing_is_public(text, uuid) from public;
grant execute on function listing_is_public(text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Row level security.
--
-- A listing's photos are exactly as public as the listing itself — the
-- traveller readers embed them for approved, listed rows and nothing else.
-- A partner sees their own regardless of state; an admin sees everything.
-- Writes go only through set_listing_photos below, same as every other table.
-- ---------------------------------------------------------------------------

alter table listing_photos enable row level security;

drop policy if exists "listing photos are as public as their listing" on listing_photos;
create policy "listing photos are as public as their listing" on listing_photos
  for select using (listing_is_public(listing_kind, listing_id));

drop policy if exists "partner sees own listing photos" on listing_photos;
create policy "partner sees own listing photos" on listing_photos
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.user_id = auth.uid()
        and pu.partner_id = listing_partner_id(listing_kind, listing_id)
    )
  );

drop policy if exists "admins see all listing photos" on listing_photos;
create policy "admins see all listing photos" on listing_photos
  for select using (is_admin());


-- ---------------------------------------------------------------------------
-- 4. set_listing_photos — replace a listing's whole gallery, in order.
--
-- Owner-only (same as every other listing write since 027) and scoped to the
-- caller's own business. `p_paths` is the ordered list of storage paths; an
-- empty array clears the gallery. photo 0 is mirrored back onto the listing's
-- `photo_path` column for the readers that still use it.
-- ---------------------------------------------------------------------------

create or replace function set_listing_photos(p_kind text, p_id uuid, p_paths text[])
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_owner   uuid;
  v_table   text;
  v_cover   text;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  v_table := case p_kind
    when 'activity' then 'activities' when 'rental' then 'vehicles'
    when 'stay' then 'stays' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' else null end;
  if v_table is null then
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  v_owner := listing_partner_id(p_kind, p_id);
  if v_owner is null or v_owner <> v_partner then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  delete from listing_photos where listing_kind = p_kind and listing_id = p_id;

  insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select p_kind, p_id, t.path, t.ord - 1
  from unnest(coalesce(p_paths, '{}'::text[])) with ordinality as t(path, ord)
  where coalesce(trim(t.path), '') <> ''
  on conflict (listing_kind, listing_id, storage_path) do nothing;

  -- Mirror photo 0 onto the vestigial column, straight from what landed.
  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_listing_photos(text, uuid, text[]) from public;
grant execute on function set_listing_photos(text, uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Backfill — every existing single photo_path becomes photo 0.
-- ---------------------------------------------------------------------------

insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select 'activity', id, photo_path, 0 from activities  where photo_path is not null
  union all select 'rental', id, photo_path, 0 from vehicles    where photo_path is not null
  union all select 'stay',   id, photo_path, 0 from stays       where photo_path is not null
  union all select 'table',  id, photo_path, 0 from restaurants where photo_path is not null
  union all select 'event',  id, photo_path, 0 from events      where photo_path is not null
  union all select 'trip',   id, photo_path, 0 from trips       where photo_path is not null
  union all select 'ferry',  id, photo_path, 0 from sailings    where photo_path is not null
on conflict (listing_kind, listing_id, storage_path) do nothing;


select 'listing photo galleries ready' as done;
