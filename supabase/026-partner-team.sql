-- ===========================================================================
-- Migration 026 — a business can have more than one person
--
-- partner_users has carried a `role` column ('owner' / 'staff') since 005,
-- and nothing has ever set it to anything but 'owner' (register_partner) or
-- read it for a decision. This migration makes it mean something: an owner
-- can invite staff — front-desk people who check travellers in but have no
-- business seeing the earnings or editing a listing.
--
-- The invite is by email, not a link: the owner enters an email, and the
-- next time someone signs in with that Google account and isn't already
-- linked, they see "Blue Wave Divers invited you" and accept. Matches the
-- shape of self-serve registration (011) — the not-linked screen just gains
-- a second thing it can offer.
--
-- DEFERRED (deliberately, to a follow-up): the existing update_partner_* /
-- add_partner_* / schedule / closure / payout RPCs check that the caller is
-- LINKED to the partner, not that they're the OWNER. The partner app hides
-- those controls from staff, but the API doesn't enforce it yet. Closing
-- that is the next slice.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The invites.
-- ---------------------------------------------------------------------------

create table if not exists partner_invites (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  email       text not null,                       -- stored lowercased
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (partner_id, email)
);

create index if not exists partner_invites_email_idx
  on partner_invites (email) where accepted_at is null;

alter table partner_invites enable row level security;

-- The owner of the business reads its invites (for the Team screen); the
-- person invited reads their own pending one (matched on the JWT email).
drop policy if exists "owner reads team invites" on partner_invites;
create policy "owner reads team invites" on partner_invites
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = partner_invites.partner_id
        and pu.user_id = auth.uid()
        and pu.role = 'owner'
    )
  );

drop policy if exists "invited user reads own invite" on partner_invites;
create policy "invited user reads own invite" on partner_invites
  for select using (
    accepted_at is null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

grant select on partner_invites to authenticated;


-- ---------------------------------------------------------------------------
-- The one partner this account owns, or null. Not SECURITY DEFINER —
-- partner_users' "own partner link" policy is exactly what it reads.
-- ---------------------------------------------------------------------------

create or replace function my_owned_partner() returns uuid
language sql stable set search_path = public as $$
  select partner_id from partner_users
  where user_id = auth.uid() and role = 'owner'
  limit 1;
$$;

revoke all on function my_owned_partner() from public;
grant execute on function my_owned_partner() to authenticated;


-- ---------------------------------------------------------------------------
-- invite_partner_staff / revoke_partner_invite — owner only. SECURITY
-- DEFINER because both need to read auth.users to check for an existing
-- member by email.
-- ---------------------------------------------------------------------------

create or replace function invite_partner_staff(p_email text, p_role text default 'staff')
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_role    text := coalesce(nullif(trim(p_role), ''), 'staff');
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can invite people.'::text;
    return;
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That doesn''t look like an email address.'::text;
    return;
  end if;
  if v_role not in ('owner', 'staff') then
    return query select false, 'Pick a valid role.'::text;
    return;
  end if;

  if exists (
    select 1 from partner_users pu
    join auth.users u on u.id = pu.user_id
    where pu.partner_id = v_partner and lower(u.email) = v_email
  ) then
    return query select false, 'That person is already on your team.'::text;
    return;
  end if;

  insert into partner_invites (partner_id, email, role, invited_by)
  values (v_partner, v_email, v_role, auth.uid())
  on conflict (partner_id, email) do update set
    role        = excluded.role,
    invited_by  = excluded.invited_by,
    created_at  = now(),
    accepted_at = null;

  return query select true,
    'Invited. They accept it the next time they sign in with that email.'::text;
end $$;

revoke all on function invite_partner_staff(text, text) from public;
grant execute on function invite_partner_staff(text, text) to authenticated;


create or replace function revoke_partner_invite(p_invite_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can do that.'::text;
    return;
  end if;

  delete from partner_invites
  where id = p_invite_id and partner_id = v_partner and accepted_at is null;

  return query select true, 'Invite withdrawn.'::text;
end $$;

revoke all on function revoke_partner_invite(uuid) from public;
grant execute on function revoke_partner_invite(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- accept_partner_invite — the invited person, once, if not already linked.
-- ---------------------------------------------------------------------------

create or replace function accept_partner_invite(p_invite_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_pid    uuid;
  v_role   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if exists (select 1 from partner_users where user_id = auth.uid()) then
    return query select false, 'This account is already linked to a business.'::text;
    return;
  end if;

  select partner_id, role into v_pid, v_role
  from partner_invites
  where id = p_invite_id and accepted_at is null and lower(email) = v_email;

  if v_pid is null then
    return query select false, 'That invite is no longer valid.'::text;
    return;
  end if;

  insert into partner_users (user_id, partner_id, role)
  values (auth.uid(), v_pid, v_role);

  update partner_invites set accepted_at = now() where id = p_invite_id;

  return query select true, 'You''re on the team.'::text;
end $$;

revoke all on function accept_partner_invite(uuid) from public;
grant execute on function accept_partner_invite(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- remove_partner_staff — owner only; not yourself, not another owner.
-- ---------------------------------------------------------------------------

create or replace function remove_partner_staff(p_user_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  v_partner := my_owned_partner();
  if v_partner is null then
    return query select false, 'Only the business owner can do that.'::text;
    return;
  end if;

  if p_user_id = auth.uid() then
    return query select false, 'You can''t remove yourself.'::text;
    return;
  end if;

  delete from partner_users
  where user_id = p_user_id and partner_id = v_partner and role = 'staff';

  if not found then
    return query select false, 'They''re not a staff member on your team.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end $$;

revoke all on function remove_partner_staff(uuid) from public;
grant execute on function remove_partner_staff(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Reads for the two screens. SECURITY DEFINER so they can join auth.users
-- for the email; each is scoped inside to what the caller may see.
-- ---------------------------------------------------------------------------

create or replace function partner_team()
returns table (member_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pu.user_id, u.email, pu.role, pu.created_at
  from partner_users pu
  join auth.users u on u.id = pu.user_id
  where pu.partner_id = my_owned_partner()
  order by (pu.role <> 'owner'), pu.created_at;
$$;

revoke all on function partner_team() from public;
grant execute on function partner_team() to authenticated;


create or replace function my_pending_invites()
returns table (invite_id uuid, partner_name text, role text)
language sql stable security definer set search_path = public as $$
  select pi.id, p.name, pi.role
  from partner_invites pi
  join partners p on p.id = pi.partner_id
  where pi.accepted_at is null
    and lower(pi.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function my_pending_invites() from public;
grant execute on function my_pending_invites() to authenticated;


-- Check: the invites table answers.
select count(*) as partner_invites_rows from partner_invites;
