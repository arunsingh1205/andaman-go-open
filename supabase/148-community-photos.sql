-- ===========================================================================
-- Migration 148 — community services join the listing photo gallery
--
-- 037 gave activities, vehicles, stays, restaurants, events, trips and
-- sailings a shared photo gallery (listing_photos + set_listing_photos);
-- 049 and 096 added cab and stay to that same map. community_services never
-- got a branch anywhere in that chain — it has no photo_path column, isn't
-- in the listing_kind check constraint, and listing_partner_id /
-- listing_is_public / set_listing_photos / admin_set_listing_photos all
-- silently treat 'community' as "unknown listing type". A community listing
-- has only ever had `mark`, the two-letter coloured tile — no real photo,
-- anywhere.
--
-- That's also why sharing a community listing's link showed a bare generic
-- "Andaman Go" card: app/community/[slug]/page.tsx's generateMetadata has
-- nothing to point an og:image at.
--
-- This migration is purely additive — a new column plus a widened constraint
-- and four CASE statements — so every one of these is create-or-replace-safe
-- (same input/output shape) except the constraint, which is dropped and
-- re-added the same way 096 already widened it for 'stay'.
--
-- Safe to run more than once.
-- ===========================================================================

alter table community_services add column if not exists photo_path text;

alter table listing_photos drop constraint if exists listing_photos_listing_kind_check;
alter table listing_photos add constraint listing_photos_listing_kind_check
  check (listing_kind in ('activity','rental','table','event','trip','ferry','cab','stay','community'));

create or replace function listing_partner_id(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_kind
    when 'activity'  then select partner_id into v from activities  where id = p_id;
    when 'rental'    then select partner_id into v from vehicles    where id = p_id;
    when 'cab'       then select partner_id into v from cabs        where id = p_id;
    when 'table'     then select partner_id into v from restaurants where id = p_id;
    when 'event'     then select partner_id into v from events      where id = p_id;
    when 'trip'      then select partner_id into v from trips       where id = p_id;
    when 'ferry'     then select partner_id into v from sailings    where id = p_id;
    when 'stay'      then select partner_id into v from stays       where id = p_id;
    when 'community' then select partner_id into v from community_services where id = p_id;
    else v := null;
  end case;
  return v;
end $$;

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
    when 'cab' then select x.is_listed and p.status = 'approved' into v
      from cabs x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'table' then select x.is_listed and p.status = 'approved' into v
      from restaurants x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'event' then select x.is_listed and p.status = 'approved' into v
      from events x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'trip' then select x.is_listed and p.status = 'approved' into v
      from trips x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'ferry' then select x.is_listed and p.status = 'approved' into v
      from sailings x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'stay' then select x.is_listed and p.status = 'approved' into v
      from stays x join partners p on p.id = x.partner_id where x.id = p_id;
    when 'community' then select x.is_listed and p.status = 'approved' into v
      from community_services x join partners p on p.id = x.partner_id where x.id = p_id;
    else v := false;
  end case;
  return coalesce(v, false);
end $$;

revoke all on function listing_is_public(text, uuid) from public;
grant execute on function listing_is_public(text, uuid) to anon, authenticated;

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
    when 'cab' then 'cabs' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' when 'stay' then 'stays'
    when 'community' then 'community_services' else null end;
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

  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_listing_photos(text, uuid, text[]) from public;
grant execute on function set_listing_photos(text, uuid, text[]) to authenticated;

create or replace function admin_set_listing_photos(p_kind text, p_id uuid, p_paths text[])
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_table text;
  v_cover text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_table := case p_kind
    when 'activity' then 'activities' when 'rental' then 'vehicles'
    when 'cab' then 'cabs' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' when 'stay' then 'stays'
    when 'community' then 'community_services' else null end;
  if v_table is null then
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if listing_partner_id(p_kind, p_id) is null then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  delete from listing_photos where listing_kind = p_kind and listing_id = p_id;

  insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select p_kind, p_id, t.path, t.ord - 1
  from unnest(coalesce(p_paths, '{}'::text[])) with ordinality as t(path, ord)
  where coalesce(trim(t.path), '') <> ''
  on conflict (listing_kind, listing_id, storage_path) do nothing;

  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_listing_photos(text, uuid, text[]) from public;
grant execute on function admin_set_listing_photos(text, uuid, text[]) to authenticated;

select 'community services can now carry a real photo gallery' as done;
