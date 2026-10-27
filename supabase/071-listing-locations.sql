-- ===========================================================================
-- Migration 071 — a Google Maps location per restaurant / activity listing
--
-- The business profile (partners.address / partners.maps_url — 011 + 014) is
-- the headquarters: one address for the whole business. But a partner who
-- runs the same restaurant on two islands has ONE pending business and TWO
-- listings, and "Directions" on a Port Blair booking was sending the traveller
-- to the Havelock branch — my_bookings (067) resolved the location off the
-- partner, never the listing that was actually booked.
--
-- This gives `restaurants` and `activities` their own optional address + Maps
-- link. Left blank, a listing falls back to the business profile, so nothing
-- changes for a single-location partner. Two operational setters (owner-only,
-- ownership-checked) back the listing forms, and my_bookings now prefers the
-- listing's own location over the partner's.
--
-- Location is operational, not content Andaman Go re-reviews: the setters
-- leave is_listed alone, exactly like the schedule editors (017).
--
-- Safe to run more than once.
-- ===========================================================================

alter table restaurants add column if not exists address  text;
alter table restaurants add column if not exists maps_url text;
alter table activities  add column if not exists address  text;
alter table activities  add column if not exists maps_url text;


-- ---------------------------------------------------------------------------
-- 1. Operational setters. Owner-only (assert_partner_owner, 027) and scoped
--    to the caller's own partner_id, and they do NOT touch is_listed —
--    same discipline as set_partner_restaurant_tables (017). An empty string
--    clears the override and the listing falls back to the business profile.
-- ---------------------------------------------------------------------------

create or replace function set_partner_restaurant_location(
  p_id uuid, p_address text, p_maps_url text
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

  if not exists (select 1 from restaurants where id = p_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  update restaurants set
    address  = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), '')
  where id = p_id and partner_id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_restaurant_location(uuid, text, text) from public;
grant execute on function set_partner_restaurant_location(uuid, text, text) to authenticated;


create or replace function set_partner_activity_location(
  p_id uuid, p_address text, p_maps_url text
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
    address  = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), '')
  where id = p_id and partner_id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_activity_location(uuid, text, text) from public;
grant execute on function set_partner_activity_location(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. subject_address / subject_maps_url — the listing's own location, or the
--    business profile's when the listing sets none. SECURITY DEFINER for the
--    same reason partner_address (014) is: a booking can outlive its listing
--    being unlisted, and my_bookings runs security_invoker. `table` and
--    `activity` carry their own; every other kind resolves to the partner.
-- ---------------------------------------------------------------------------

create or replace function subject_address(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(address), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(address), '') from restaurants where id = p_subject_id)
    end,
    partner_address(p_partner_id)
  )
$$;

create or replace function subject_maps_url(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(maps_url), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(maps_url), '') from restaurants where id = p_subject_id)
    end,
    partner_maps_url(p_partner_id)
  )
$$;

revoke all on function subject_address(text, uuid, uuid)  from public;
revoke all on function subject_maps_url(text, uuid, uuid) from public;
grant execute on function subject_address(text, uuid, uuid)  to authenticated, anon;
grant execute on function subject_maps_url(text, uuid, uuid) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- 3. my_bookings — point the two location columns at the listing-aware
--    helpers. Whole view restated from 067; CREATE OR REPLACE VIEW keeps the
--    column list, only the maps_url / address expressions change.
-- ---------------------------------------------------------------------------

create or replace view my_bookings as
select
  i.id                                as item_id,
  b.id                                as booking_id,
  b.ref_code,
  b.on_date,
  b.island_slug,
  isl.name                            as island_name,
  i.kind,
  i.subject_id,
  subject_title(i.kind, i.subject_id) as title,
  partner_name(i.partner_id)          as operator,
  i.starts_at,
  i.party,
  i.price_paise,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  subject_maps_url(i.kind, i.subject_id, i.partner_id) as maps_url,
  subject_address(i.kind, i.subject_id, i.partner_id)  as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating,
  partner_phone(i.partner_id)         as operator_phone,
  i.refund_status
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


select 'listing locations installed' as done;
