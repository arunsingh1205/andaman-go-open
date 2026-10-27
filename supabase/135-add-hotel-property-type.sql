-- Add "hotel" as a stay property type, alongside homestay/guesthouse/villa/
-- resort/hostel (096). Partners were asking for it directly — a hotel isn't
-- quite a resort or a guesthouse, and forcing one of those mislabels the
-- listing for travellers.

alter table stays drop constraint stays_property_type_check;
alter table stays add constraint stays_property_type_check
  check (property_type in ('homestay','guesthouse','villa','resort','hostel','hotel'));

create or replace function add_partner_stay(
  p_name                text,
  p_island_slug         text,
  p_property_type       text,
  p_area                text,
  p_tagline             text default '',
  p_about               text default '',
  p_amenities           text[] default '{}',
  p_house_rules         text default '',
  p_cancellation_policy text default 'moderate',
  p_check_in_mins       integer default 840,
  p_check_out_mins      integer default 660,
  p_photo_path          text default null
) returns table(ok boolean, message text, stay_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_slug    text;
  v_mark    text;
  v_id      uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;
  if not exists (select 1 from partners where id = v_partner and kind = 'stay') then
    return query select false, 'This business is not registered as a stay.'::text, null::uuid;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose which island this property is actually on.'::text, null::uuid;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel','hotel') then
    return query select false, 'Choose a valid property type.'::text, null::uuid;
    return;
  end if;
  if p_cancellation_policy not in ('flexible','moderate','strict') then
    return query select false, 'Choose a valid cancellation policy.'::text, null::uuid;
    return;
  end if;
  if p_check_in_mins is null or p_check_in_mins not between 0 and 1439
     or p_check_out_mins is null or p_check_out_mins not between 0 and 1439 then
    return query select false, 'Choose valid check-in and check-out times.'::text, null::uuid;
    return;
  end if;

  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'stays');

  insert into stays (
    slug, partner_id, island_slug, mark, name, property_type, area, tagline, about,
    amenities, house_rules, cancellation_policy, check_in_mins, check_out_mins,
    is_listed, photo_path
  ) values (
    v_slug, v_partner, p_island_slug, v_mark, trim(p_name), p_property_type,
    coalesce(nullif(trim(p_area), ''), 'Near the property'),
    coalesce(trim(p_tagline), ''), coalesce(trim(p_about), ''),
    coalesce(p_amenities, '{}'), coalesce(trim(p_house_rules), ''), p_cancellation_policy,
    p_check_in_mins, p_check_out_mins, false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. Add your room types next, then submit for review.'::text, v_id;
end $$;

create or replace function update_partner_stay(
  p_id                  uuid,
  p_name                text,
  p_island_slug         text,
  p_property_type       text,
  p_area                text,
  p_tagline             text default '',
  p_about               text default '',
  p_amenities           text[] default '{}',
  p_house_rules         text default '',
  p_cancellation_policy text default 'moderate',
  p_check_in_mins       integer default 840,
  p_check_out_mins      integer default 660,
  p_photo_path          text default null
) returns table(ok boolean, message text)
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
    return query select false, 'Give the property a name.'::text;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose which island this property is actually on.'::text;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel','hotel') then
    return query select false, 'Choose a valid property type.'::text;
    return;
  end if;
  if p_cancellation_policy not in ('flexible','moderate','strict') then
    return query select false, 'Choose a valid cancellation policy.'::text;
    return;
  end if;
  if p_check_in_mins is null or p_check_in_mins not between 0 and 1439
     or p_check_out_mins is null or p_check_out_mins not between 0 and 1439 then
    return query select false, 'Choose valid check-in and check-out times.'::text;
    return;
  end if;

  select is_listed into v_was_listed from stays where id = p_id and partner_id = v_partner;
  if v_was_listed is null then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update stays set
    name = trim(p_name),
    island_slug = p_island_slug,
    property_type = p_property_type,
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    tagline = coalesce(trim(p_tagline), ''),
    about = coalesce(trim(p_about), ''),
    amenities = coalesce(p_amenities, '{}'),
    house_rules = coalesce(trim(p_house_rules), ''),
    cancellation_policy = p_cancellation_policy,
    check_in_mins = p_check_in_mins,
    check_out_mins = p_check_out_mins,
    photo_path = coalesce(p_photo_path, photo_path),
    is_listed = case when v_was_listed then false else is_listed end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end $$;

create or replace function admin_update_stay(
  p_id                  uuid,
  p_name                text,
  p_island_slug         text,
  p_property_type       text,
  p_area                text,
  p_tagline             text,
  p_about               text,
  p_amenities           text[],
  p_house_rules         text,
  p_cancellation_policy text,
  p_check_in_mins       integer,
  p_check_out_mins      integer
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the property a name.'::text;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose which island this property is actually on.'::text;
    return;
  end if;
  if p_property_type not in ('homestay','guesthouse','villa','resort','hostel','hotel') then
    return query select false, 'Choose a valid property type.'::text;
    return;
  end if;

  update stays set
    name = trim(p_name),
    island_slug = p_island_slug,
    property_type = p_property_type,
    area = coalesce(nullif(trim(p_area), ''), 'Near the property'),
    tagline = coalesce(trim(p_tagline), ''),
    about = coalesce(trim(p_about), ''),
    amenities = coalesce(p_amenities, '{}'),
    house_rules = coalesce(trim(p_house_rules), ''),
    cancellation_policy = coalesce(p_cancellation_policy, cancellation_policy),
    check_in_mins = coalesce(p_check_in_mins, check_in_mins),
    check_out_mins = coalesce(p_check_out_mins, check_out_mins)
  where id = p_id;
  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;
