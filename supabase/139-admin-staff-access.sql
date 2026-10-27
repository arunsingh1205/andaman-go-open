-- ===========================================================================
-- Migration 139 — staff access to the admin console
--
-- Until now `admins` was flat: one row, one meaning — full access to
-- everything is_admin() gates, and the only way in was Arun linking an
-- account by hand in the SQL editor (012's own header comment says so
-- explicitly: "nobody self-serves their way into admins"). Arun wants to
-- bring staff onto the console now, with access to everything except three
-- areas that are either money-sensitive (Revenue, Settlements) or reach
-- outside the business to partners and travellers (Communications) — and a
-- proper invite flow: type in a staff member's email, they get a "set your
-- password" email, they sign in the same way a partner does.
--
-- What this does:
--   1. admins.role ('owner' | 'staff'), defaulting existing rows to 'owner'.
--      is_admin() is UNCHANGED — it still means "any row in admins", owner
--      or staff, so none of the ~50 existing is_admin()-gated RPCs and views
--      need to change; staff keeps that same broad access by construction.
--   2. is_admin_owner() — the new, narrower check for the three restricted
--      areas and for staff management itself.
--   3. admin_add_staff / admin_remove_staff / admin_list_staff — the RPCs
--      the new Staff screen calls. The account itself is created the same
--      way ops onboarding creates a partner's login (Admin API,
--      auth.admin.createUser(), from the Server Action layer, not from
--      SQL) — these RPCs only ever touch the `admins` row once that auth
--      user already exists.
--   4. Re-gate the three restricted areas' exclusive-to-them RPCs/policies
--      from is_admin() to is_admin_owner(): broadcast_campaigns (writes),
--      run_settlement, mark_settlement_paid, and the admin-side read
--      policies on settlement_batches/settlement_items. Revenue has no
--      RPC/table of its own to re-gate — it's built entirely from
--      admin_bookings, a view Bookings and a partner's own track record
--      also depend on — so Revenue's restriction is enforced at the route
--      level (app/admin/.../revenue/page.tsx), not the database. Staff
--      already sees the same per-booking figures via Bookings; what's
--      hidden is the aggregated monthly view, not raw data unique to it.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The role column. Every existing admin (today, just Arun) becomes
--    'owner' by the default — nobody's access changes on this migration.
-- ---------------------------------------------------------------------------

alter table admins add column if not exists role text not null default 'owner'
  check (role in ('owner', 'staff'));


-- ---------------------------------------------------------------------------
-- 2. is_admin_owner() — same shape as is_admin() (025's is_admin, 012's
--    original), just the narrower row.
-- ---------------------------------------------------------------------------

create or replace function is_admin_owner() returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid() and role = 'owner');
$$;

-- `from public` alone isn't enough for a genuinely new function name — this
-- project's default privileges auto-grant EXECUTE to `anon` regardless (the
-- same gotcha hit in 137b for set_partner_commission). Every new function
-- below needs the explicit `, anon` too.
revoke all on function is_admin_owner() from public, anon;
grant execute on function is_admin_owner() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Staff management — owner only. The Server Action layer creates the
--    auth.users row (Admin API) before calling admin_add_staff; these RPCs
--    only ever manage the `admins` row on an account that already exists.
-- ---------------------------------------------------------------------------

create or replace function admin_add_staff(p_user_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_owner() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  insert into admins (user_id, role) values (p_user_id, 'staff')
  on conflict (user_id) do update set role = 'staff'
  where admins.role <> 'owner';

  return query select true, 'Staff access granted.'::text;
end $$;

revoke all on function admin_add_staff(uuid) from public, anon;
grant execute on function admin_add_staff(uuid) to authenticated;


create or replace function admin_remove_staff(p_user_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_owner() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- The `and role = 'staff'` guard means this can never remove an owner's
  -- own access through this path, even by mistake.
  delete from admins where user_id = p_user_id and role = 'staff';

  if not found then
    return query select false, 'That staff member could not be found.'::text;
    return;
  end if;

  return query select true, 'Staff access removed.'::text;
end $$;

revoke all on function admin_remove_staff(uuid) from public, anon;
grant execute on function admin_remove_staff(uuid) to authenticated;


create or replace function admin_list_staff()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_owner() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select a.user_id, u.email::text, a.role, a.created_at
    from admins a
    join auth.users u on u.id = a.user_id
    order by a.role desc, a.created_at asc;
end $$;

revoke all on function admin_list_staff() from public, anon;
grant execute on function admin_list_staff() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Communications — exclusively broadcast_campaigns (109). The welcome
--    template's own public SELECT policy (111) is untouched; that's the
--    anon client reading one specific row to send the live welcome email,
--    unrelated to who can manage campaigns in the console.
-- ---------------------------------------------------------------------------

drop policy if exists "admin manages broadcast campaigns" on broadcast_campaigns;
create policy "admin manages broadcast campaigns" on broadcast_campaigns
  for all using (is_admin_owner()) with check (is_admin_owner());


-- ---------------------------------------------------------------------------
-- 5. Settlements — run_settlement, mark_settlement_paid, and the admin-side
--    read policies on settlement_batches/settlement_items (101/105). A
--    partner's own read of their own settlement rows (101's other two
--    policies) is untouched.
-- ---------------------------------------------------------------------------

drop policy if exists "admins see all settlement batches" on settlement_batches;
create policy "admins see all settlement batches" on settlement_batches
  for select using (is_admin_owner());

drop policy if exists "admins see all settlement items" on settlement_items;
create policy "admins see all settlement items" on settlement_items
  for select using (is_admin_owner());

create or replace function run_settlement(p_period_start date, p_period_end date)
returns table (partner_id uuid, items_settled int, net_payable_paise int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_owner() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  return query select * from run_settlement_impl(p_period_start, p_period_end);
end $$;

revoke all on function run_settlement(date, date) from public;
grant execute on function run_settlement(date, date) to authenticated;


-- Base is 107's redefinition (not 105's — 107 added whatsapp_number to the
-- result shape after 105 shipped the owner-email columns), so this keeps
-- that column rather than silently dropping it.
drop function if exists mark_settlement_paid(uuid, text, text);

create function mark_settlement_paid(
  p_batch_id uuid, p_reference text, p_note text default null
) returns table (
  ok boolean, message text, owner_email text, whatsapp_number text, partner_name text,
  net_payable_paise int, payout_reference text
)
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_partner uuid;
  v_net     int;
begin
  if not is_admin_owner() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reference), '') = '' then
    return query select false, 'Add a bank/UPI reference before marking this paid.'::text,
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;

  select status, partner_id, net_payable_paise into v_status, v_partner, v_net
  from settlement_batches where id = p_batch_id for update;

  if v_status is null then
    return query select false, 'That settlement batch no longer exists.'::text,
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;
  if v_status = 'paid' then
    return query select false, 'That batch is already marked paid.'::text,
      null::text, null::text, null::text, null::int, null::text;
    return;
  end if;

  update settlement_batches set
    status = 'paid', paid_at = now(), paid_by = auth.uid(),
    payout_reference = trim(p_reference), payout_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_batch_id;

  return query
    select
      true, 'Marked paid.'::text, u.email::text, p.whatsapp_number, p.name, v_net, trim(p_reference)
    from partners p
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = v_partner and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    where p.id = v_partner;
end $$;

-- `drop function` + `create function` (needed because the RETURNS TABLE
-- shape is unchanged from 107 but this redefinition still goes through the
-- same drop+create pattern 107 used) resets privileges to the defaults —
-- same anon leak as the brand-new functions above, needs the same fix.
revoke all on function mark_settlement_paid(uuid, text, text) from public, anon;
grant execute on function mark_settlement_paid(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Check: every admin's role.
-- ---------------------------------------------------------------------------

select role, count(*) from admins group by role;
