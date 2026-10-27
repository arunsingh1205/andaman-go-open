-- ===========================================================================
-- Migration 093 — deleting a business or a listing, for real this time
--
-- Every takedown the console could already do (admin_reject_listing,
-- admin_unlist_listing, admin_suspend_partner) is reversible on purpose: the
-- partner can fix what was wrong and resubmit, or an admin can bring a
-- suspended business back. None of them is "make this go away for good",
-- which is the thing actually being asked for here — a spam signup, a
-- listing added by mistake, a business that closed down.
--
-- This does NOT drop the row. Two things in the schema make a hard delete
-- the wrong call:
--
--   1. booking_items.subject_id (schema.sql) is a bare uuid with no foreign
--      key to activities/vehicles/cabs/restaurants/events/trips/sailings/
--      community_services — it's polymorphic, keyed by kind. Deleting a
--      catalogue row wouldn't fail, but subject_title() (049) would start
--      returning null for every past booking of it, silently corrupting
--      booking history a traveller or partner might still need to look at.
--
--   2. booking_items.partner_id DOES have a foreign key to partners(id),
--      with no ON DELETE clause (so it defaults to RESTRICT). Any partner
--      that has ever taken a booking cannot be deleted outright — the
--      delete would simply fail in the database the first time it mattered.
--
-- So "delete" here means the same kind of state change as suspend/unlist,
-- just a further, one-way step: hidden from every screen that lists live,
-- pending or rejected things, no resubmit, no reactivate. The row — and
-- every booking that points at it — stays intact.
--
-- Same discipline as every admin function since 012: SECURITY DEFINER,
-- is_admin() checked explicitly, a hardcoded branch per kind, and a reason
-- required at the database level. Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. A listing can now be deleted, on top of being pending/live/rejected.
-- deleted_at is separate from is_listed/rejection_reason: those two already
-- mean "not currently bookable" for three different reasons (never
-- reviewed, sent back, taken down), and none of them should be read as
-- "gone" by the queue screens. deleted_at is the one column that means that.
-- ---------------------------------------------------------------------------

alter table activities          add column if not exists deleted_at timestamptz;
alter table vehicles            add column if not exists deleted_at timestamptz;
alter table cabs                add column if not exists deleted_at timestamptz;
alter table restaurants         add column if not exists deleted_at timestamptz;
alter table events              add column if not exists deleted_at timestamptz;
alter table trips               add column if not exists deleted_at timestamptz;
alter table sailings            add column if not exists deleted_at timestamptz;
alter table community_services  add column if not exists deleted_at timestamptz;


-- ---------------------------------------------------------------------------
-- 2. A partner can now be deleted, alongside pending/approved/suspended/
-- rejected. Reuses rejection_reason for the same reason suspension does
-- (018) — one column, one meaning, and the partner's own Business tab
-- already knows how to show it.
-- ---------------------------------------------------------------------------

alter table partners drop constraint partners_status_check;
alter table partners add constraint partners_status_check
  check (status in ('pending', 'approved', 'suspended', 'rejected', 'deleted'));


-- ---------------------------------------------------------------------------
-- 3. admin_delete_listing — permanent, from any state (pending, live, or
-- already rejected). Unlike admin_unlist_listing, this doesn't require the
-- listing to currently be live — a listing that was never approved can be
-- just as much spam as one that was.
-- ---------------------------------------------------------------------------

create or replace function admin_delete_listing(p_kind text, p_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean := false;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before deleting.'::text;
    return;
  end if;

  if p_kind = 'activity' then
    update activities set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, deleted_at = now(), rejection_reason = trim(p_reason)
      where id = p_id and deleted_at is null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing is already deleted, or no longer exists.'::text;
    return;
  end if;

  return query select true, 'Deleted.'::text;
end;
$$;

revoke all on function admin_delete_listing(text, uuid, text) from public;
grant execute on function admin_delete_listing(text, uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. admin_delete_partner — deletes the business, and pulls every one of
-- its listings off the app the same way admin_suspend_partner's status
-- change already does via RLS. The listings themselves are only unlisted
-- here, not marked deleted_at — the business is what's gone; if that turns
-- out to be a mistake there is nothing stopping a fresh admin_reject/
-- approve cycle on the listings once the business itself is sorted out.
-- (Reactivation is deliberately not offered: admin_reactivate_partner only
-- ever accepts a 'suspended' business, so a deleted one has no way back
-- except a human with database access, on purpose — same one-way logic as
-- deleting a listing.)
-- ---------------------------------------------------------------------------

create or replace function admin_delete_partner(p_partner_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before deleting.'::text;
    return;
  end if;

  select status into v_status from partners where id = p_partner_id for update;

  if v_status is null then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  if v_status = 'deleted' then
    return query select false, 'That business is already deleted.'::text;
    return;
  end if;

  update partners
  set status = 'deleted', rejection_reason = trim(p_reason)
  where id = p_partner_id;

  update activities          set is_listed = false where partner_id = p_partner_id and is_listed;
  update vehicles            set is_listed = false where partner_id = p_partner_id and is_listed;
  update cabs                set is_listed = false where partner_id = p_partner_id and is_listed;
  update restaurants         set is_listed = false where partner_id = p_partner_id and is_listed;
  update events              set is_listed = false where partner_id = p_partner_id and is_listed;
  update trips               set is_listed = false where partner_id = p_partner_id and is_listed;
  update sailings            set is_listed = false where partner_id = p_partner_id and is_listed;
  update community_services  set is_listed = false where partner_id = p_partner_id and is_listed;

  return query select true, 'Deleted.'::text;
end;
$$;

revoke all on function admin_delete_partner(uuid, text) from public;
grant execute on function admin_delete_partner(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. delete_partner_listing — the partner's own side. Owner-only, same
-- _owner_wrap_prepare split as every other owner-only RPC since 027: the
-- real logic lives in delete_partner_listing_impl, scoped to whichever
-- partner the caller is linked to, and the thin wrapper in front of it
-- checks that link is an owner, not just staff.
--
-- No reason column here — unlike an admin taking something away from a
-- partner, this is the partner removing their own listing. Nothing else
-- reads a reason for it.
-- ---------------------------------------------------------------------------

create or replace function delete_partner_listing_impl(p_kind text, p_id uuid)
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
    update activities set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'cab' then
    update cabs set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'table' then
    update restaurants set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'event' then
    update events set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'trip' then
    update trips set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'ferry' then
    update sailings set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  elsif p_kind = 'community' then
    update community_services set is_listed = false, deleted_at = now()
      where id = p_id and partner_id = v_partner and deleted_at is null;
    v_hit := found;
  else
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  if not v_hit then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end;
$$;

revoke all on function delete_partner_listing_impl(text, uuid) from public, anon, authenticated;

create or replace function delete_partner_listing(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from delete_partner_listing_impl(p_kind, p_id);
end $$;

revoke all on function delete_partner_listing(text, uuid) from public;
grant execute on function delete_partner_listing(text, uuid) to authenticated;


select 'listing and partner delete installed' as done;
