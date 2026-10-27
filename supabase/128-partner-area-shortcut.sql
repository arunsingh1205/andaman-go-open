-- ===========================================================================
-- Migration 128 — a shortcut to set a rental shop's area right from the
-- vehicle listing screen, not just the Business tab.
--
-- 127 added partners.area and wired it into the business-profile editor
-- (update_partner_profile), but a rental partner managing their listings
-- from Admin -> Listings -> Rentals (or their own Business -> a vehicle)
-- had no area field in front of them there — the shop's area was a click
-- away on a different screen. These two lightweight setters (same
-- "operational setter" shape as set_partner_activity_location, 071 — no
-- other business-profile fields required, so a form that only has a
-- vehicle loaded doesn't need to fetch/carry the rest of the profile just
-- to change one field) let the vehicle edit form set it directly.
--
-- Both write the exact same column update_partner_profile already writes,
-- so nothing about how area is read back (lib/rentals.ts's Shop.area,
-- lib/partner-register.ts's OwnBusiness.area) changes.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function set_partner_shop_area(p_area text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  update partners set area = nullif(trim(p_area), '') where id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_shop_area(text) from public;
grant execute on function set_partner_shop_area(text) to authenticated;


create or replace function admin_set_partner_area(p_partner_id uuid, p_area text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  update partners set area = nullif(trim(p_area), '') where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_area(uuid, text) from public;
grant execute on function admin_set_partner_area(uuid, text) to authenticated;


select 'partner shop-area shortcut setters installed' as done;
