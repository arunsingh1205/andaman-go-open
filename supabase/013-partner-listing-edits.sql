-- Editing a listing already added.
--
-- 011 gave partners "add a listing"; this gives them "edit one" — same
-- ownership discipline (look up the caller's own partner_id, never trust one
-- from the client), same validation as the matching add_partner_* function.
-- Category/type is never editable here (activities.category, vehicles.type,
-- stays.type) — changing it would mean regenerating slug/mark/code, more
-- risk than a name/price/photo fix should carry.
--
-- One deliberate behaviour: editing a listing that is currently LIVE
-- (is_listed = true) sends it back to pending (is_listed = false) for a
-- quick recheck — an approval Andaman Go gave to one version of a listing
-- shouldn't silently carry over to a different version they never saw.
-- Editing a listing that's still pending, or one that was rejected, just
-- saves the changes in place and leaves is_listed / rejection_reason alone
-- (a rejected one still needs its own resubmit_partner_listing afterward).

create or replace function update_partner_activity(
  p_id uuid,
  p_name text,
  p_summary text,
  p_about text,
  p_price_paise int,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;

  select is_listed into v_was_listed from activities where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update activities set
    name = trim(p_name),
    summary = coalesce(trim(p_summary), ''),
    about = coalesce(trim(p_about), ''),
    price_paise = p_price_paise,
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

revoke all on function update_partner_activity(uuid, text, text, text, int, text) from public;
grant execute on function update_partner_activity(uuid, text, text, text, int, text) to authenticated;

create or replace function update_partner_vehicle(
  p_id uuid,
  p_model text,
  p_rate_paise int,
  p_seats int,
  p_meta text,
  p_units int,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
  v_seats int;
  v_units int;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the vehicle a model name.'::text;
    return;
  end if;
  if p_rate_paise is null or p_rate_paise < 0 then
    return query select false, 'Enter a valid rate.'::text;
    return;
  end if;

  v_seats := greatest(coalesce(p_seats, 2), 1);
  v_units := greatest(coalesce(p_units, 1), 1);

  select is_listed into v_was_listed from vehicles where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update vehicles set
    model = trim(p_model),
    rate_paise = p_rate_paise,
    seats = v_seats,
    meta = coalesce(trim(p_meta), ''),
    units = v_units,
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

revoke all on function update_partner_vehicle(uuid, text, int, int, text, int, text) from public;
grant execute on function update_partner_vehicle(uuid, text, int, int, text, int, text) to authenticated;

create or replace function update_partner_stay(
  p_id uuid,
  p_name text,
  p_area text,
  p_price_paise int,
  p_blurb text,
  p_about text,
  p_amenities text[] default '{}',
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the room or stay a name.'::text;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text;
    return;
  end if;

  select is_listed into v_was_listed from stays where id = p_id and partner_id = v_partner;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update stays set
    name = trim(p_name),
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    price_paise = p_price_paise,
    blurb = coalesce(trim(p_blurb), ''),
    about = coalesce(trim(p_about), ''),
    amenities = coalesce(p_amenities, '{}'),
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

revoke all on function update_partner_stay(uuid, text, text, int, text, text, text[], text) from public;
grant execute on function update_partner_stay(uuid, text, text, int, text, text, text[], text) to authenticated;
