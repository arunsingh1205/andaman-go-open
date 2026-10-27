-- Ops-led partner onboarding — Phase 1 (cab category only).
--
-- Gives a new Ops role (distinct from Partner and Admin) a way to create a
-- partner's login and first listing in one sitting, on-site, instead of
-- Arun hand-creating an email/password login and walking them through
-- self-registration. Mirrors the admins/is_admin() shape exactly (012):
-- no self-serve ops sign-up, Arun links ops teammates' user_id by hand in
-- the SQL editor after their first Google sign-in.
--
-- The two RPCs below (ops_register_partner, ops_add_cab) are the ops-side
-- twins of register_partner (011/059/069) and add_partner_car (049) — same
-- validation, same is_listed = false / status = 'pending' landing spot —
-- except they act on a p_user_id/p_partner_id the caller supplies rather
-- than deriving identity from auth.uid(), because ops is creating a login
-- and listing for someone else, not themselves. Gated by is_ops() instead
-- of "must be signed in" / assert_partner_owner().

-- ---------------------------------------------------------------------------
-- Who's ops. Same shape as admins (012): one row per ops account, a plain
-- self-select policy, is_admin()'s exact template for is_ops().
-- ---------------------------------------------------------------------------

create table ops_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table ops_users enable row level security;

create policy "ops see own row" on ops_users
  for select using (user_id = auth.uid());

create or replace function is_ops() returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from ops_users where user_id = auth.uid());
$$;

revoke all on function is_ops() from public;
grant execute on function is_ops() to authenticated;

-- ---------------------------------------------------------------------------
-- Which ops member onboarded a partner, and whether that partner's login
-- still needs its one-time temp password replaced before it can be used.
-- must_reset_password lives on partner_users (the actual login link, PK'd
-- on user_id), not partners (a business isn't itself a login), so it stays
-- correct if a business is ever handed to a different login later.
-- ---------------------------------------------------------------------------

alter table partners add column created_by uuid references auth.users(id);

alter table partner_users add column must_reset_password boolean not null default false;

-- ---------------------------------------------------------------------------
-- ops_register_partner — same body as register_partner (059), minus the
-- "must be signed in as the partner" check, plus is_ops() and an explicit
-- target user_id. Always lands at status = 'pending', same as self-serve.
-- ---------------------------------------------------------------------------

create or replace function ops_register_partner(
  p_user_id uuid,
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null
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

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (slug, name, kind, island_slug, contact_phone, address, maps_url, status, created_by)
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(trim(p_contact_phone), ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending', auth.uid()
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role, must_reset_password)
  values (p_user_id, v_id, 'owner', true);

  return query select true, 'Partner registered.'::text, v_id;
end;
$$;

revoke all on function ops_register_partner(uuid, text, text, text, text, text, text) from public;
grant execute on function ops_register_partner(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ops_add_cab — same body as add_partner_car (049), minus
-- assert_partner_owner()/auth.uid()-derived partner lookup, plus is_ops()
-- and an explicit p_partner_id. Same code-generation and validation.
-- ---------------------------------------------------------------------------

create or replace function ops_add_cab(
  p_partner_id uuid,
  p_category text,
  p_model text,
  p_seats int,
  p_luggage int,
  p_ac boolean,
  p_fuel text,
  p_board_number text,
  p_full_day_paise int,
  p_airport_surcharge_paise int default 0,
  p_night_surcharge_paise int default 0,
  p_per_km_paise int default 0,
  p_per_min_paise int default 0,
  p_meta text default ''
) returns table (ok boolean, message text, cab_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  if not is_ops() then
    raise exception 'ops access required' using errcode = '42501';
  end if;

  if not exists (select 1 from partners where id = p_partner_id and kind = 'cab') then
    return query select false, 'This partner is not a cab operator.'::text, null::uuid;
    return;
  end if;

  if p_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid car type.'::text, null::uuid;
    return;
  end if;
  if p_fuel not in ('ev','petrol','diesel') then
    return query select false, 'Choose petrol, diesel or electric.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the car a model name.'::text, null::uuid;
    return;
  end if;
  if p_full_day_paise is null or p_full_day_paise < 0 then
    return query select false, 'Enter a valid full-day fare.'::text, null::uuid;
    return;
  end if;

  loop
    v_code := trim(both '-' from regexp_replace(lower(p_model), '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    select exists(select 1 from cabs where partner_id = p_partner_id and code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into cabs (
    code, partner_id, category, model, seats, luggage, ac, fuel, board_number,
    full_day_paise, airport_surcharge_paise, night_surcharge_paise,
    per_km_paise, per_min_paise, meta, is_listed
  ) values (
    v_code, p_partner_id, p_category, trim(p_model),
    greatest(coalesce(p_seats, 4), 1), greatest(coalesce(p_luggage, 0), 0),
    coalesce(p_ac, true), p_fuel, nullif(trim(p_board_number), ''),
    p_full_day_paise, greatest(coalesce(p_airport_surcharge_paise, 0), 0),
    greatest(coalesce(p_night_surcharge_paise, 0), 0),
    greatest(coalesce(p_per_km_paise, 0), 0), greatest(coalesce(p_per_min_paise, 0), 0),
    coalesce(trim(p_meta), ''), false
  )
  returning id into v_id;

  return query select true, 'Cab added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function ops_add_cab(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text) from public;
grant execute on function ops_add_cab(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- clear_must_reset_password — the partner's own side, called right after
-- they successfully set a real password on /partner/set-password. Scoped to
-- auth.uid() like every partner-side RPC, no ops gate: they're clearing
-- their own flag, not acting on someone else's.
-- ---------------------------------------------------------------------------

create or replace function clear_must_reset_password() returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  update partner_users set must_reset_password = false where user_id = auth.uid();

  return query select true, 'Password updated.'::text;
end;
$$;

revoke all on function clear_must_reset_password() from public;
grant execute on function clear_must_reset_password() to authenticated;

select 'ops onboarding ready' as done;
