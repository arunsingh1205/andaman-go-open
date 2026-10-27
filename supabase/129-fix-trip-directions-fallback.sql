-- ===========================================================================
-- Migration 129 — restores the 'trip' branch of subject_address/
-- subject_maps_url, dropped by accident.
--
-- 076 added a 'trip' case (reads trips.meet_point/maps_url) explicitly for
-- the bookings-list Directions button. 096 then did `create or replace
-- function subject_address/subject_maps_url` to add a 'stay' case — but
-- `create or replace` replaces the WHOLE function body, and 096 was written
-- against 071's original activity/table-only version, not 076's. It
-- silently dropped 'trip' on the way to adding 'stay'.
--
-- Net effect since 096 shipped: a trip booking's Directions button
-- (app/bookings/bookings-list.tsx) has been falling straight to the
-- partner's registered business address instead of the trip's actual
-- meeting point — exactly the bug 071 was written to fix in the first
-- place, reintroduced for trips specifically. This just re-adds the case;
-- everything else in both functions is copied verbatim from 096's current
-- version, not rewritten.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function subject_address(
  p_kind text, p_subject_id uuid, p_partner_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_kind
      when 'activity' then (select nullif(trim(address), '') from activities  where id = p_subject_id)
      when 'table'    then (select nullif(trim(address), '') from restaurants where id = p_subject_id)
      when 'stay'     then (select nullif(trim(address), '') from stays       where id = p_subject_id)
      when 'trip'     then (select nullif(trim(meet_point), '') from trips    where id = p_subject_id)
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
      when 'stay'     then (select nullif(trim(maps_url), '') from stays       where id = p_subject_id)
      when 'trip'     then (select nullif(trim(maps_url), '') from trips      where id = p_subject_id)
    end,
    partner_maps_url(p_partner_id)
  )
$$;

revoke all on function subject_address(text, uuid, uuid)  from public;
revoke all on function subject_maps_url(text, uuid, uuid) from public;
grant execute on function subject_address(text, uuid, uuid)  to authenticated, anon;
grant execute on function subject_maps_url(text, uuid, uuid) to authenticated, anon;


select 'trip directions fallback restored' as done;
