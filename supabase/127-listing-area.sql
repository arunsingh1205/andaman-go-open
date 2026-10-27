-- ===========================================================================
-- Migration 127 — a short "area" label for activities and rental shops, so
-- a traveller comparing cards can see which is actually nearby before
-- opening either one.
--
-- restaurants, events and stays already have exactly this (a short text
-- area — "Aberdeen Bazaar", "Near Radhanagar Beach" — collected on the
-- add-listing form, shown on the card). Activities and rentals were the two
-- listing types that never got it. Rather than invent a new mechanism, this
-- extends the two setters that already exist for "location-ish" data on
-- these listing types:
--   · set_partner_activity_location / admin_set_listing_location (071) —
--     already sets an activity's own address + Maps link; now also its area.
--     A blank area falls back to the shop/partner's own area, same fallback
--     071 already established for address/maps_url.
--   · update_partner_profile / admin_update_partner_profile (011/075) —
--     the business-profile editor. A rental shop IS its partner row (no
--     separate "shop" table), so the shop's area belongs here.
--
-- Both setters gained a parameter (not a signature-compatible change), so
-- each is dropped and recreated with its new arg list rather than
-- create-or-replaced in place — Postgres treats a different arity as a new
-- overload, not a replacement, and leaving the old one behind would just be
-- dead, still-revoked clutter.
--
-- Safe to run more than once.
-- ===========================================================================

alter table activities add column if not exists area text;
alter table partners   add column if not exists area text;


-- ---------------------------------------------------------------------------
-- 1. set_partner_activity_location — now also takes an area.
-- ---------------------------------------------------------------------------

drop function if exists set_partner_activity_location(uuid, text, text);

create or replace function set_partner_activity_location(
  p_id uuid, p_area text, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from activities where id = p_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update activities set
    area     = nullif(trim(p_area), ''),
    address  = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), '')
  where id = p_id and partner_id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_activity_location(uuid, text, text, text) from public;
grant execute on function set_partner_activity_location(uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. admin_set_listing_location — same, for the 'activity' branch. Leaves
--    the 'table' (restaurant) branch alone: restaurants already collect
--    area through add_partner_restaurant/update_partner_restaurant, this
--    function was never how theirs gets set.
-- ---------------------------------------------------------------------------

drop function if exists admin_set_listing_location(text, uuid, text, text);

create or replace function admin_set_listing_location(
  p_kind text, p_id uuid, p_area text, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_kind = 'activity' then
    update activities set
      area     = nullif(trim(p_area), ''),
      address  = nullif(trim(p_address), ''),
      maps_url = nullif(trim(p_maps_url), '')
    where id = p_id;
  elsif p_kind = 'table' then
    update restaurants set
      address  = nullif(trim(p_address), ''),
      maps_url = nullif(trim(p_maps_url), '')
    where id = p_id;
  else
    return query select false, 'That listing type has no separate location.'::text;
    return;
  end if;

  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_listing_location(text, uuid, text, text, text) from public;
grant execute on function admin_set_listing_location(text, uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. update_partner_profile — owner-wrapped (027): a thin wrapper delegating
--    to update_partner_profile_impl. Both need the new arg, so both are
--    dropped and recreated here directly (no need to go through
--    _owner_wrap_prepare again — that helper is for the one-time rename,
--    not for later signature changes to an already-wrapped function).
-- ---------------------------------------------------------------------------

drop function if exists update_partner_profile_impl(text, text, text, text, text);

create or replace function update_partner_profile_impl(
  p_address text,
  p_maps_url text,
  p_cover_photo_path text,
  p_license_number text,
  p_license_doc_path text,
  p_area text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partners set
    address = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), ''),
    cover_photo_path = p_cover_photo_path,
    license_number = nullif(trim(p_license_number), ''),
    license_doc_path = p_license_doc_path,
    area = nullif(trim(p_area), '')
  where id = v_partner;

  return query select true, 'Saved.'::text;
end;
$$;

revoke all on function update_partner_profile_impl(text, text, text, text, text, text) from public, anon, authenticated;

drop function if exists update_partner_profile(text, text, text, text, text);

create or replace function update_partner_profile(
  p_address text,
  p_maps_url text,
  p_cover_photo_path text,
  p_license_number text,
  p_license_doc_path text,
  p_area text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_profile_impl(
    p_address, p_maps_url, p_cover_photo_path, p_license_number, p_license_doc_path, p_area
  );
end $$;

revoke all on function update_partner_profile(text, text, text, text, text, text) from public;
grant execute on function update_partner_profile(text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_update_partner_profile — same new field, admin-gated directly
--    (not owner-wrapped, so no _impl split needed here).
-- ---------------------------------------------------------------------------

drop function if exists admin_update_partner_profile(uuid, text, text, text, text, text, text, text);

create or replace function admin_update_partner_profile(
  p_partner_id uuid, p_name text, p_island_slug text, p_address text, p_maps_url text,
  p_cover_photo_path text, p_license_number text, p_license_doc_path text, p_area text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the business a name.'::text;
    return;
  end if;
  if coalesce(trim(p_island_slug), '') <> ''
     and not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text;
    return;
  end if;

  update partners set
    name = trim(p_name),
    island_slug = coalesce(nullif(trim(p_island_slug), ''), island_slug),
    address = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), ''),
    cover_photo_path = p_cover_photo_path,
    license_number = nullif(trim(p_license_number), ''),
    license_doc_path = p_license_doc_path,
    area = nullif(trim(p_area), '')
  where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_update_partner_profile(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function admin_update_partner_profile(uuid, text, text, text, text, text, text, text, text) to authenticated;


select 'listing area columns + setters installed' as done;
