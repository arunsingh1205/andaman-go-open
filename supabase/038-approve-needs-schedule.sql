-- ===========================================================================
-- Migration 038 — an activity or restaurant can't go live with no times
--
-- 017 gave partners a schedule editor, but adding times is a separate step
-- from adding the listing, and nothing made them do it. So an activity could
-- be submitted, approved, and shown to travellers with zero rows in
-- activity_schedule — the booking screen then renders "Pick a day" with
-- nothing under it, and the listing looks broken.
--
-- This adds one guard to admin_approve_listing: an 'activity' needs at least
-- one activity_schedule row and a 'table' needs at least one restaurant_tables
-- row before it can be approved. The partner-facing nudge that tells them to
-- add times lives in the app (business-view.tsx). The other five kinds carry
-- their recurrence on the row itself (events: on_date; trips: runs_on_days;
-- ferries: days_of_week; rentals: rental_hours + units) so they need no guard.
--
-- Body is otherwise identical to 016's admin_approve_listing. No signature
-- change. Safe to run more than once.
-- ===========================================================================

create or replace function admin_approve_listing(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind = 'activity' and not exists (
    select 1 from activity_schedule where activity_id = p_id
  ) then
    return query select false, 'Add at least one time slot before approving this activity.'::text;
    return;
  end if;

  if p_kind = 'table' and not exists (
    select 1 from restaurant_tables where restaurant_id = p_id
  ) then
    return query select false, 'Add at least one table sitting before approving this restaurant.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = true, rejection_reason = null where id = p_id;
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
end;
$$;

select 'approve-needs-schedule guard in place' as done;
