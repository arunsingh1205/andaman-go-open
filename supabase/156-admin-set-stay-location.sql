-- ===========================================================================
-- Migration 156 — admin_set_stay_location
--
-- Saving a stay from the admin console failed with "Something went wrong".
-- The last step of that save calls admin_set_listing_location(p_kind, p_id,
-- p_address, p_maps_url) with p_kind = 'stay'. Migration 127 replaced that
-- 4-argument function with a 5-argument one (adds p_area) that only knows
-- 'activity' and 'table', and 130 kept it that way — so the stay call no
-- longer matches any function. Stays have no area-on-location rule (their
-- area is part of the stay details), so they get their own twin of
-- set_partner_stay_location (096) instead of being squeezed back into the
-- shared one.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function admin_set_stay_location(
  p_id uuid, p_address text, p_maps_url text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  update stays set
    address  = nullif(trim(p_address), ''),
    maps_url = nullif(trim(p_maps_url), '')
  where id = p_id;

  if not found then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_stay_location(uuid, text, text) from public;
grant execute on function admin_set_stay_location(uuid, text, text) to authenticated;
