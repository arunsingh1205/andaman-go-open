-- ===========================================================================
-- Migration 049 — the Cab / car service, functions
--
--   * the shared kind-dispatch functions gain a 'cab' branch (and lose 'stay')
--   * add_partner_car / update_partner_car / set_car_routes — the partner writes
--   * create_cab_booking — fare + airport/night surcharge + "is this car free
--     on those dates" check + the booking_items and cab_trip_details write,
--     all in one transaction
--   * cab_load_on — how many cars are out on a date, for the catalogue
--   * the admin approve/reject/unlist/resubmit RPCs learn 'cab'
--
-- A cab's subject is its operator (a partner), exactly as a rental's subject is
-- its shop — so subject_title / record_listing_view / the rating blend all
-- resolve 'cab' to `partners`, same as 'rental'.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. subject_title — a cab booking reads as the operator's name.
-- ---------------------------------------------------------------------------

create or replace function subject_title(p_kind text, p_subject_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'activity' then (select name from activities where id = p_subject_id)
    when 'ferry'    then (select fi.name || ' → ' || ti.name
                          from sailings s
                          join islands fi on fi.slug = s.from_island
                          join islands ti on ti.slug = s.to_island
                          where s.id = p_subject_id)
    when 'table'    then (select name from restaurants where id = p_subject_id)
    when 'event'    then (select name from events where id = p_subject_id)
    when 'trip'     then (select title from trips where id = p_subject_id)
    when 'rental'   then (select name from partners where id = p_subject_id)
    when 'cab'      then (select name from partners where id = p_subject_id)
  end
$$;


-- ---------------------------------------------------------------------------
-- 2. record_listing_view — 'cab' resolves to the operator, like 'rental'.
-- ---------------------------------------------------------------------------

create or replace function record_listing_view(p_kind text, p_subject text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid;
  v_partner uuid;
begin
  case p_kind
    when 'activity' then
      select id, partner_id into v_subject, v_partner from activities where slug = p_subject;
    when 'table' then
      select id, partner_id into v_subject, v_partner from restaurants where slug = p_subject;
    when 'event' then
      select id, partner_id into v_subject, v_partner from events where slug = p_subject;
    when 'trip' then
      select id, partner_id into v_subject, v_partner from trips where slug = p_subject;
    when 'rental' then
      select id, id into v_subject, v_partner from partners where slug = p_subject;
    when 'cab' then
      select id, id into v_subject, v_partner from partners where slug = p_subject;
    else
      return;
  end case;

  if v_subject is null then
    return;
  end if;

  insert into listing_views (kind, subject_id, partner_id)
  values (p_kind, v_subject, v_partner);
end $$;

revoke all on function record_listing_view(text, text) from public;
grant execute on function record_listing_view(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The rating blend and the public review read — 'cab' uses the operator's
--    seed_rating / seed_reviews on the partner row, like 'rental'.
-- ---------------------------------------------------------------------------

create or replace function recompute_listing_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind    text := coalesce(new.kind, old.kind);
  v_subject uuid := coalesce(new.subject_id, old.subject_id);
  v_seed_r  numeric;
  v_seed_c  int;
  v_real_sum bigint;
  v_real_cnt int;
  v_total   int;
  v_blend   numeric;
begin
  select coalesce(sum(rating), 0), count(*)
    into v_real_sum, v_real_cnt
  from reviews where kind = v_kind and subject_id = v_subject;

  if v_kind = 'activity' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from activities where id = v_subject;
  elsif v_kind = 'table' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from restaurants where id = v_subject;
  elsif v_kind = 'event' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from events where id = v_subject;
  elsif v_kind = 'trip' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from trips where id = v_subject;
  elsif v_kind in ('rental', 'cab') then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from partners where id = v_subject;
  else
    return null;
  end if;

  v_seed_r := coalesce(v_seed_r, 0);
  v_seed_c := coalesce(v_seed_c, 0);
  v_total  := v_seed_c + v_real_cnt;

  if v_total = 0 then
    return null;
  end if;

  v_blend := round((v_seed_r * v_seed_c + v_real_sum) / v_total, 1);

  if v_kind = 'activity' then
    update activities set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'table' then
    update restaurants set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'event' then
    update events set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'trip' then
    update trips set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind in ('rental', 'cab') then
    update partners set rating = v_blend, reviews = v_total where id = v_subject;
  end if;

  return null;
end $$;

create or replace function listing_reviews(p_kind text, p_subject text)
returns table (rating int, body text, reply text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  case p_kind
    when 'activity' then select id into v_id from activities where slug = p_subject;
    when 'table'    then select id into v_id from restaurants where slug = p_subject;
    when 'event'    then select id into v_id from events where slug = p_subject;
    when 'trip'     then select id into v_id from trips where slug = p_subject;
    when 'rental'   then select id into v_id from partners where slug = p_subject;
    when 'cab'      then select id into v_id from partners where slug = p_subject;
    else return;
  end case;

  if v_id is null then
    return;
  end if;

  return query
    select r.rating, r.body, r.reply, r.created_at
    from reviews r
    where r.kind = p_kind and r.subject_id = v_id
    order by r.created_at desc;
end $$;

revoke all on function listing_reviews(text, text) from public;
grant execute on function listing_reviews(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. listing_photos helpers + set_listing_photos — 'cab' -> table `cabs`.
-- ---------------------------------------------------------------------------

create or replace function listing_partner_id(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_kind
    when 'activity' then select partner_id into v from activities  where id = p_id;
    when 'rental'   then select partner_id into v from vehicles    where id = p_id;
    when 'cab'      then select partner_id into v from cabs        where id = p_id;
    when 'table'    then select partner_id into v from restaurants where id = p_id;
    when 'event'    then select partner_id into v from events      where id = p_id;
    when 'trip'     then select partner_id into v from trips       where id = p_id;
    when 'ferry'    then select partner_id into v from sailings    where id = p_id;
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
-- 5. Admin approve / reject / unlist / resubmit — a 'cab' branch each.
--    Bodies carried over from 038 / 016 / 018.
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
-- resubmit_partner_listing_impl — so the cab branch goes in the _impl body,
-- and 027's wrapper is left untouched.
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


-- ---------------------------------------------------------------------------
-- 6. add_partner_car / update_partner_car — same shape as the vehicle RPCs.
-- ---------------------------------------------------------------------------

create or replace function add_partner_car(
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
  p_meta text default '',
  p_photo_path text default null
) returns table (ok boolean, message text, cab_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_code text;
  v_exists boolean;
  v_id uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;
  if not exists (select 1 from partners where id = v_partner and kind = 'cab') then
    return query select false, 'This business is not a cab operator.'::text, null::uuid;
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
    select exists(select 1 from cabs where partner_id = v_partner and code = v_code) into v_exists;
    exit when not v_exists;
  end loop;

  insert into cabs (
    code, partner_id, category, model, seats, luggage, ac, fuel, board_number,
    full_day_paise, airport_surcharge_paise, night_surcharge_paise,
    per_km_paise, per_min_paise, meta, is_listed, photo_path
  ) values (
    v_code, v_partner, p_category, trim(p_model),
    greatest(coalesce(p_seats, 4), 1), greatest(coalesce(p_luggage, 0), 0),
    coalesce(p_ac, true), p_fuel, nullif(trim(p_board_number), ''),
    p_full_day_paise, greatest(coalesce(p_airport_surcharge_paise, 0), 0),
    greatest(coalesce(p_night_surcharge_paise, 0), 0),
    greatest(coalesce(p_per_km_paise, 0), 0), greatest(coalesce(p_per_min_paise, 0), 0),
    coalesce(trim(p_meta), ''), false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end $$;

revoke all on function add_partner_car(text, text, int, int, boolean, text, text, int, int, int, int, int, text, text) from public;
grant execute on function add_partner_car(text, text, int, int, boolean, text, text, int, int, int, int, int, text, text) to authenticated;


create or replace function update_partner_car(
  p_id uuid,
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
  p_meta text default '',
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_was_listed boolean;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_category not in ('hatchback','sedan','suv','tempo') then
    return query select false, 'Choose a valid car type.'::text;
    return;
  end if;
  if p_fuel not in ('ev','petrol','diesel') then
    return query select false, 'Choose petrol, diesel or electric.'::text;
    return;
  end if;
  if coalesce(trim(p_model), '') = '' then
    return query select false, 'Give the car a model name.'::text;
    return;
  end if;
  if p_full_day_paise is null or p_full_day_paise < 0 then
    return query select false, 'Enter a valid full-day fare.'::text;
    return;
  end if;

  select is_listed into v_was_listed from cabs where id = p_id and partner_id = v_partner;
  if v_was_listed is null then
    return query select false, 'That car no longer exists.'::text;
    return;
  end if;

  update cabs set
    category = p_category,
    model = trim(p_model),
    seats = greatest(coalesce(p_seats, 4), 1),
    luggage = greatest(coalesce(p_luggage, 0), 0),
    ac = coalesce(p_ac, true),
    fuel = p_fuel,
    board_number = nullif(trim(p_board_number), ''),
    full_day_paise = p_full_day_paise,
    airport_surcharge_paise = greatest(coalesce(p_airport_surcharge_paise, 0), 0),
    night_surcharge_paise = greatest(coalesce(p_night_surcharge_paise, 0), 0),
    per_km_paise = greatest(coalesce(p_per_km_paise, 0), 0),
    per_min_paise = greatest(coalesce(p_per_min_paise, 0), 0),
    meta = coalesce(trim(p_meta), ''),
    photo_path = coalesce(p_photo_path, photo_path),
    is_listed = case when v_was_listed then false else is_listed end,
    rejection_reason = case when v_was_listed then rejection_reason else rejection_reason end
  where id = p_id and partner_id = v_partner;

  if v_was_listed then
    return query select true, 'Saved. Sent back for a quick recheck since it was already live.'::text;
  else
    return query select true, 'Saved.'::text;
  end if;
end $$;

revoke all on function update_partner_car(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text, text) from public;
grant execute on function update_partner_car(uuid, text, text, int, int, boolean, text, text, int, int, int, int, int, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. set_car_routes — replace one car's whole route set. p_routes is a jsonb
--    array of { from_place_id, to_place_id, oneway_paise, roundtrip_paise }.
--    Operational data, not content Andaman Go re-reviews — so it does NOT send
--    a live car back to pending.
-- ---------------------------------------------------------------------------

create or replace function set_car_routes(p_cab_id uuid, p_routes jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_row     jsonb;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from cabs where id = p_cab_id and partner_id = v_partner) then
    return query select false, 'That car no longer exists.'::text;
    return;
  end if;

  if p_routes is null or jsonb_typeof(p_routes) <> 'array' then
    p_routes := '[]'::jsonb;
  end if;

  for v_row in select * from jsonb_array_elements(p_routes) loop
    if (v_row->>'from_place_id') is null or (v_row->>'to_place_id') is null then
      return query select false, 'Every route needs a pickup and a drop.'::text;
      return;
    end if;
    if (v_row->>'from_place_id') = (v_row->>'to_place_id') then
      return query select false, 'A route''s pickup and drop must differ.'::text;
      return;
    end if;
    if not exists (select 1 from cab_places where id = (v_row->>'from_place_id')::uuid) or
       not exists (select 1 from cab_places where id = (v_row->>'to_place_id')::uuid) then
      return query select false, 'One of those places is no longer on the map.'::text;
      return;
    end if;
    if coalesce((v_row->>'oneway_paise')::int, 0) < 0
       or coalesce((v_row->>'roundtrip_paise')::int, 0) < 0 then
      return query select false, 'Fares can''t be negative.'::text;
      return;
    end if;
  end loop;

  delete from cab_routes where cab_id = p_cab_id;

  insert into cab_routes (cab_id, from_place_id, to_place_id, oneway_paise, roundtrip_paise)
  select p_cab_id,
         (r->>'from_place_id')::uuid,
         (r->>'to_place_id')::uuid,
         greatest(coalesce((r->>'oneway_paise')::int, 0), 0),
         greatest(coalesce((r->>'roundtrip_paise')::int, 0), 0)
  from jsonb_array_elements(p_routes) r
  on conflict (cab_id, from_place_id, to_place_id) do update
    set oneway_paise = excluded.oneway_paise,
        roundtrip_paise = excluded.roundtrip_paise;

  return query select true, 'Route fares saved.'::text;
end $$;

revoke all on function set_car_routes(uuid, jsonb) from public;
grant execute on function set_car_routes(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. cab_load_on — how many cars are out on a date. Security definer so a
--    logged-out traveller sees a car that is already taken (same trade as
--    rental_load_on, 043).
-- ---------------------------------------------------------------------------

create or replace function cab_load_on(p_date date)
returns table (cab_code text, out_count bigint)
language sql stable security definer set search_path = public as $$
  select c.code, count(*)
  from booking_items bi
  join cabs c on c.id = bi.cab_id
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.state in ('pending','confirmed','disrupted','completed')
    and p_date >= (bi.starts_at at time zone 'Asia/Kolkata')::date
    and p_date <= case d.trip_type
          when 'fullday'   then (bi.starts_at at time zone 'Asia/Kolkata')::date + (d.days - 1)
          when 'roundtrip' then coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date)
          else (bi.starts_at at time zone 'Asia/Kolkata')::date
        end
  group by c.code
$$;

revoke all on function cab_load_on(date) from public;
grant execute on function cab_load_on(date) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. create_cab_booking — the one door. Fare, surcharges, and the "is this car
--    free" check all happen here, never trusted from the browser.
-- ---------------------------------------------------------------------------

create or replace function create_cab_booking(
  p_operator     text,
  p_cab          text,
  p_trip_type    text,
  p_from         uuid,
  p_to           uuid,
  p_starts_at    timestamptz,
  p_return_date  date default null,
  p_days         int  default 1,
  p_pickup_note  text default '',
  p_pay_mode     text default 'none'
)
returns table (
  ref_code text, ticket_code text, fare_paise int,
  paid_online_paise int, balance_paise int
)
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_operator  uuid;
  v_cab_id    uuid;
  v_island    text;
  v_full_day  int;
  v_air_sur   int;
  v_night_sur int;
  v_base      int;
  v_fare      int;
  v_days      int := greatest(coalesce(p_days, 1), 1);
  v_start_day date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_end_day   date;
  v_time_mins int := extract(hour from p_starts_at at time zone 'Asia/Kolkata') * 60
                   + extract(minute from p_starts_at at time zone 'Asia/Kolkata');
  v_is_airport boolean;
  v_night     boolean;
  v_clash     int;
  v_paid      int;
  v_balance   int;
  v_booking   uuid;
  v_ref       text;
  v_ticket    text;
  v_kind_seq  int;
  v_item      uuid;
  v_phone     text;
  v_email     text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_trip_type not in ('oneway','roundtrip','fullday') then
    raise exception 'unknown trip type "%"', p_trip_type using errcode = '22023';
  end if;
  if p_pay_mode not in ('none','full') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;

  select p.id, c.id, p.island_slug, c.full_day_paise,
         c.airport_surcharge_paise, c.night_surcharge_paise
    into v_operator, v_cab_id, v_island, v_full_day, v_air_sur, v_night_sur
  from partners p
  join cabs c on c.partner_id = p.id and c.code = p_cab and c.is_listed
  where p.slug = p_operator and p.kind = 'cab' and p.status = 'approved';

  if v_cab_id is null then
    raise exception 'nothing bookable found for cab "%"', p_cab using errcode = '22023';
  end if;

  -- Fare.
  if p_trip_type = 'fullday' then
    v_base := v_full_day * v_days;
    v_end_day := v_start_day + (v_days - 1);
  else
    if p_from is null or p_to is null or p_from = p_to then
      raise exception 'a pickup and a drop are required' using errcode = '22023';
    end if;

    select case when p_trip_type = 'roundtrip' then roundtrip_paise else oneway_paise end
      into v_base
    from cab_routes
    where cab_id = v_cab_id and from_place_id = p_from and to_place_id = p_to;

    if v_base is null or v_base <= 0 then
      raise exception 'no fare set for this route' using errcode = '22023';
    end if;

    if p_trip_type = 'roundtrip' then
      if p_return_date is null or p_return_date < v_start_day then
        raise exception 'the return date must be on or after the pickup date' using errcode = '22023';
      end if;
      v_end_day := p_return_date;
    else
      v_end_day := v_start_day;
    end if;
  end if;

  v_is_airport := p_trip_type <> 'fullday' and exists (
    select 1 from cab_places where id in (p_from, p_to) and is_airport
  );
  v_night := v_time_mins >= 22 * 60 or v_time_mins < 6 * 60;

  v_fare := v_base
          + case when v_is_airport then v_air_sur else 0 end
          + case when v_night then v_night_sur else 0 end;

  -- Is this car free across [v_start_day .. v_end_day]? One car = one unit.
  perform pg_advisory_xact_lock(hashtext('cab:' || v_cab_id::text));

  select count(*) into v_clash
  from booking_items bi
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.cab_id = v_cab_id
    and bi.state in ('pending','confirmed','disrupted','completed')
    and (bi.starts_at at time zone 'Asia/Kolkata')::date <= v_end_day
    and case d.trip_type
          when 'fullday'   then (bi.starts_at at time zone 'Asia/Kolkata')::date + (d.days - 1)
          when 'roundtrip' then coalesce(d.return_date, (bi.starts_at at time zone 'Asia/Kolkata')::date)
          else (bi.starts_at at time zone 'Asia/Kolkata')::date
        end >= v_start_day;

  if v_clash > 0 then
    raise exception 'this car is booked for those dates' using errcode = '23514';
  end if;

  -- Payment split.
  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := 0; v_balance := v_fare;
  end if;

  -- One reference per traveller per day, same as create_booking.
  select id, bookings.ref_code into v_booking, v_ref
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select phone, email into v_phone, v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_phone, contact_email)
    values (v_ref, v_user, v_island, v_start_day, v_phone, v_email)
    returning id into v_booking;
  end if;

  select count(*) into v_kind_seq
  from booking_items where booking_id = v_booking and kind = 'cab';

  v_ticket := v_ref || '-C' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;

  insert into booking_items
    (booking_id, kind, subject_id, cab_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, ticket_code, confirmed_at)
  values
    (v_booking, 'cab', v_operator, v_cab_id, v_operator, p_starts_at,
     1, case when p_trip_type = 'fullday' then v_days else 1 end,
     v_fare, p_pay_mode, v_paid, v_balance,
     'confirmed', v_ticket, now())
  returning id into v_item;

  insert into cab_trip_details
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note)
  values
    (v_item, p_trip_type,
     case when p_trip_type = 'fullday' then null else p_from end,
     case when p_trip_type = 'fullday' then null else p_to end,
     case when p_trip_type = 'roundtrip' then p_return_date else null end,
     v_days, coalesce(trim(p_pickup_note), ''));

  return query select v_ref, v_ticket, v_fare, v_paid, v_balance;
end $$;

revoke all on function create_cab_booking(text, text, text, uuid, uuid, timestamptz, date, int, text, text) from public;
grant execute on function create_cab_booking(text, text, text, uuid, uuid, timestamptz, date, int, text, text) to authenticated, anon;


select 'cab RPCs ready' as done;
