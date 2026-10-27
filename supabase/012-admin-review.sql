-- Admin review panel.
--
-- 011 gave partners a way to submit themselves and their listings; this
-- migration gives Arun a screen to act on what piles up as a result, instead
-- of the Supabase table editor. There is no admin sign-up, on purpose —
-- unlike partners, nobody self-serves their way into `admins`. Arun links his
-- own account in by hand the first time, in the SQL editor, exactly the way
-- partner accounts used to be linked before 011:
--   insert into admins (user_id) values ('<his auth.users id>');
--
-- Two review queues, matching the two gates from 011:
--   - pending partners: status = 'pending' on the `partners` table itself.
--   - pending listings: is_listed = false and rejection_reason is null, on
--     activities / vehicles / stays.
-- A reject on either sets a reason a partner can read and clears once they
-- resubmit — approve/pending/reject is a real three-state loop, not just a
-- one-way gate.

-- ---------------------------------------------------------------------------
-- Who's an admin. One row per admin account; a plain self-select policy is
-- all this needs; is_admin() is not SECURITY DEFINER, so RLS on this table
-- still applies when it runs, but the self-select policy is exactly what it
-- reads (its own row, to check its own membership) — nothing more.
-- ---------------------------------------------------------------------------

create table admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

create policy "admins see own row" on admins
  for select using (user_id = auth.uid());

create or replace function is_admin() returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Reviewed things need a third state beyond "pending" / "approved": rejected,
-- with a reason a partner can actually read and act on. Partners: a real
-- status. Listings: is_listed stays the boolean it already was (false until
-- approved), with rejection_reason distinguishing "never looked at yet" (null)
-- from "looked at, sent back" (set) within that same false state.
-- ---------------------------------------------------------------------------

alter table partners drop constraint partners_status_check;
alter table partners add constraint partners_status_check
  check (status in ('pending', 'approved', 'suspended', 'rejected'));

alter table partners   add column rejection_reason text;
alter table activities add column rejection_reason text;
alter table vehicles   add column rejection_reason text;
alter table stays      add column rejection_reason text;

-- ---------------------------------------------------------------------------
-- Admins need to see every partner/listing, not just approved or their own —
-- additive to the existing public + "partner sees own" policies.
-- ---------------------------------------------------------------------------

create policy "admins see all partners" on partners
  for select using (is_admin());

create policy "admins see all activities" on activities
  for select using (is_admin());

create policy "admins see all vehicles" on vehicles
  for select using (is_admin());

create policy "admins see all stays" on stays
  for select using (is_admin());

-- Licence documents live in a private bucket — admins need to read across
-- every partner's folder, not just their own (there is no "own folder" for
-- an admin). Additive to the partner-scoped policy from 011.

create policy "admins read all license docs" on storage.objects
  for select using (bucket_id = 'partner-licenses' and is_admin());

-- ---------------------------------------------------------------------------
-- admin_approve_partner / admin_reject_partner — act on the business itself.
-- SECURITY DEFINER so the update can reach any partner row; is_admin() is the
-- gate, checked explicitly rather than relied on implicitly.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_partner(p_partner_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update partners set status = 'approved', rejection_reason = null
  where id = p_partner_id;

  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Approved.'::text;
end;
$$;

revoke all on function admin_approve_partner(uuid) from public;
grant execute on function admin_approve_partner(uuid) to authenticated;

create or replace function admin_reject_partner(p_partner_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before rejecting.'::text;
    return;
  end if;

  update partners set status = 'rejected', rejection_reason = trim(p_reason)
  where id = p_partner_id;

  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Rejected.'::text;
end;
$$;

revoke all on function admin_reject_partner(uuid, text) from public;
grant execute on function admin_reject_partner(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_approve_listing / admin_reject_listing — act on one catalogue row.
-- p_kind picks the table via a hardcoded if/elsif, never dynamic SQL off
-- client input, since only three literal branches exist and each is spelled
-- out — the same caution unique_slug takes with p_table, just without even
-- needing EXECUTE here.
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

  if p_kind = 'activity' then
    update activities set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'rental' then
    update vehicles set is_listed = true, rejection_reason = null where id = p_id;
    v_hit := found;
  elsif p_kind = 'stay' then
    update stays set is_listed = true, rejection_reason = null where id = p_id;
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

revoke all on function admin_approve_listing(text, uuid) from public;
grant execute on function admin_approve_listing(text, uuid) to authenticated;

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
  elsif p_kind = 'stay' then
    update stays set is_listed = false, rejection_reason = trim(p_reason) where id = p_id;
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
end;
$$;

revoke all on function admin_reject_listing(text, uuid, text) from public;
grant execute on function admin_reject_listing(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The other side of a rejection: a partner fixing something up and sending it
-- back. Clears the reason and returns the row to its respective pending
-- bucket — pending = status 'pending' for a business, is_listed = false and
-- rejection_reason is null for a listing.
-- ---------------------------------------------------------------------------

create or replace function resubmit_partner()
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_status text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select status into v_status from partners where id = v_partner;
  if v_status is distinct from 'rejected' then
    return query select false, 'Nothing to resubmit.'::text;
    return;
  end if;

  update partners set status = 'pending', rejection_reason = null where id = v_partner;
  return query select true, 'Sent back for review.'::text;
end;
$$;

revoke all on function resubmit_partner() from public;
grant execute on function resubmit_partner() to authenticated;

create or replace function resubmit_partner_listing(p_kind text, p_id uuid)
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
  elsif p_kind = 'stay' then
    update stays set rejection_reason = null
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

  return query select true, 'Sent back for review.'::text;
end;
$$;

revoke all on function resubmit_partner_listing(text, uuid) from public;
grant execute on function resubmit_partner_listing(text, uuid) to authenticated;
