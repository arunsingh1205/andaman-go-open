-- Narrows ops partner-onboarding (131) to the two categories that actually
-- struggle with self-serve login — cabs and scooty rentals — and adds the
-- rental side, mirroring add_partner_vehicle_impl (baseline) the same way
-- 131's ops_add_cab mirrors add_partner_car.
--
-- ops_register_partner's signature changes (adds p_area), which
-- CREATE OR REPLACE can't do for an existing function — the argument list
-- has to match exactly — so the old one is dropped and recreated rather
-- than replaced in place.

drop function if exists ops_register_partner(uuid, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- ops_register_partner — same as 131's version, plus p_area. Only rental
-- shops require it (matching set_partner_shop_area's own validation, 130):
-- a rental shop can't go live without area + a map link, same as if the
-- partner had filled it in themselves on their first vehicle. Cab partners
-- carry no such requirement, so p_area stays optional/null for them.
-- ---------------------------------------------------------------------------

create or replace function ops_register_partner(
  p_user_id uuid,
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null,
  p_area text default null
) returns table (ok boolean, message text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
  v_id uuid;
begin
  if not is_ops() then
    raise exception 'ops access required' using errcode = '42501';
  end if;

  if exists (select 1 from partner_users pu where pu.user_id = p_user_id) then
    return query select false, 'That email is already linked to a business.'::text, null::uuid;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Business name is required.'::text, null::uuid;
    return;
  end if;
  if p_kind not in ('dive', 'ferry', 'restaurant', 'rental', 'venue', 'host', 'cab') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;
  if p_kind = 'rental' then
    if coalesce(trim(p_area), '') = '' then
      return query select false, 'Area is required for a rental shop.'::text, null::uuid;
      return;
    end if;
    if coalesce(trim(p_maps_url), '') = '' then
      return query select false, 'A map link is required for a rental shop.'::text, null::uuid;
      return;
    end if;
  end if;

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (slug, name, kind, island_slug, contact_phone, address, maps_url, area, status, created_by)
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(trim(p_contact_phone), ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), nullif(trim(p_area), ''), 'pending', auth.uid()
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role, must_reset_password)
  values (p_user_id, v_id, 'owner', true);

  return query select true, 'Partner registered.'::text, v_id;
end;
$$;

revoke all on function ops_register_partner(uuid, text, text, text, text, text, text, text) from public;
grant execute on function ops_register_partner(uuid, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ops_add_rental — same body as add_partner_vehicle_impl (baseline), minus
-- the auth.uid()-derived partner lookup, plus is_ops() and an explicit
-- p_partner_id. Sets security_deposit_paise directly on insert rather than
-- the partner UI's two-step add-then-set-deposit — ops submits it all at
-- once, there's no reason to split it here.
-- ---------------------------------------------------------------------------

create or replace function ops_add_rental(
  p_partner_id uuid,
  p_type text,
  p_model text,
  p_rate_paise int,
  p_seats int,
  p_meta text,
  p_units int,
  p_security_deposit_paise int default 0
) returns table (ok boolean, message text, vehicle_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_seats int;
  v_units int;
  v_exists boolean;
  v_id uuid;
begin
  if not is_ops() then
    raise exception 'ops access required' using errcode = '42501';
  end if;

  if not exists (select 1 from partners where id = p_partner_id and kind = 'rental') then
    return query select false, 'This partner is not a rental shop.'::text, null::uuid;
    return;
  end if;

  if p_type not in ('scooter', 'bike', 'bicycle') then
    return query select false, 'Choose a valid vehicle type.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the vehicle a model name.'::text, null::uuid;
    return;
  end if;
  if p_rate_paise is null or p_rate_paise < 0 then
    return query select false, 'Enter a valid rate.'::text, null::uuid;
    return;
  end if;
  if p_security_deposit_paise is null or p_security_deposit_paise < 0 then
    return query select false, 'The deposit has to be zero or more.'::text, null::uuid;
    return;
  end if;

  v_seats := greatest(coalesce(p_seats, 2), 1);
  v_units := greatest(coalesce(p_units, 1), 1);

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_model), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    select exists(select 1 from vehicles where partner_id = p_partner_id and code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into vehicles (
    code, partner_id, type, model, rate_paise, seats, meta, units, is_listed, security_deposit_paise
  ) values (
    v_code, p_partner_id, p_type, trim(p_model), p_rate_paise, v_seats,
    coalesce(trim(p_meta), ''), v_units, false, coalesce(p_security_deposit_paise, 0)
  )
  returning id into v_id;

  return query select true, 'Vehicle added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function ops_add_rental(uuid, text, text, int, int, text, int, int) from public;
grant execute on function ops_add_rental(uuid, text, text, int, int, text, int, int) to authenticated;

select 'ops onboarding: rental added, scope narrowed to cab + rental' as done;
