-- ===========================================================================
-- Migration 130 — area and a map link are now required going forward, for
-- both activities and rental shops, so the blank-area gap 127 found doesn't
-- reopen for every new listing. Enforced server-side (not just in the
-- form), same discipline as every other required field in this schema
-- ("Give the business a name.", etc.) — a client check alone is only ever
-- a convenience, never the actual gate.
--
-- Scoped narrowly on purpose: only the two setters this feature already
-- owns (set_partner_activity_location/admin_set_listing_location for
-- activities, set_partner_shop_area/admin_set_partner_area for rentals).
-- update_partner_profile/admin_update_partner_profile — the *generic*
-- business-profile editor every partner kind uses — is deliberately left
-- alone; making area/maps_url mandatory there would reach cabs, stays and
-- every other kind that never asked for this.
--
-- Address stays optional on both — only area and maps_url (the "map") were
-- asked to be mandatory.
--
-- set_partner_shop_area/admin_set_partner_area also gain p_maps_url here
-- (arity change, so dropped and recreated) — until now they only carried
-- area.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function set_partner_activity_location(
  p_id uuid, p_area text, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  if coalesce(trim(p_area), '') = '' then
    return query select false, 'Area is required.'::text;
    return;
  end if;
  if coalesce(trim(p_maps_url), '') = '' then
    return query select false, 'A map link is required.'::text;
    return;
  end if;

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from activities where id = p_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update activities set
    area     = trim(p_area),
    address  = nullif(trim(p_address), ''),
    maps_url = trim(p_maps_url)
  where id = p_id and partner_id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

create or replace function admin_set_listing_location(
  p_kind text, p_id uuid, p_area text, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if p_kind = 'activity' then
    if coalesce(trim(p_area), '') = '' then
      return query select false, 'Area is required.'::text;
      return;
    end if;
    if coalesce(trim(p_maps_url), '') = '' then
      return query select false, 'A map link is required.'::text;
      return;
    end if;

    update activities set
      area     = trim(p_area),
      address  = nullif(trim(p_address), ''),
      maps_url = trim(p_maps_url)
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


drop function if exists set_partner_shop_area(text);

create or replace function set_partner_shop_area(p_area text, p_maps_url text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  if coalesce(trim(p_area), '') = '' then
    return query select false, 'Area is required.'::text;
    return;
  end if;
  if coalesce(trim(p_maps_url), '') = '' then
    return query select false, 'A map link is required.'::text;
    return;
  end if;

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partners set area = trim(p_area), maps_url = trim(p_maps_url) where id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_shop_area(text, text) from public;
grant execute on function set_partner_shop_area(text, text) to authenticated;


drop function if exists admin_set_partner_area(uuid, text);

create or replace function admin_set_partner_area(p_partner_id uuid, p_area text, p_maps_url text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_area), '') = '' then
    return query select false, 'Area is required.'::text;
    return;
  end if;
  if coalesce(trim(p_maps_url), '') = '' then
    return query select false, 'A map link is required.'::text;
    return;
  end if;

  update partners set area = trim(p_area), maps_url = trim(p_maps_url) where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_area(uuid, text, text) from public;
grant execute on function admin_set_partner_area(uuid, text, text) to authenticated;


select 'area + map link now mandatory for activities and rental shops' as done;
