-- ===========================================================================
-- Migration 094 — where to send a push.
--
-- 020-partner-notifications.sql wrote the feed rows but deliberately stopped
-- at "the app re-reads on navigation" — no push. This is the missing half of
-- that: one table of device tokens, one RPC to register one, same "one door"
-- discipline as the rest of the partner schema (the trigger/RPC writes, the
-- app never inserts directly).
--
-- One row per installed app instance, keyed by the FCM token itself — a
-- device re-registers on every app open (harmless, `on conflict` just bumps
-- last_seen_at), and if staff sign out and a different partner signs in on
-- the same phone, the same token simply moves to the new partner_id instead
-- of leaving a stale row pointing at the wrong business.
--
-- Sending the actual push (calling Firebase Admin's send API when a row
-- lands in partner_notifications) is a later slice — this only gets the
-- token onto the phone and into this table.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists partner_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references partners(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('android', 'ios')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists partner_push_tokens_partner_idx
  on partner_push_tokens (partner_id);

alter table partner_push_tokens enable row level security;

-- No select/insert/update/delete policy for anyone — a partner has no
-- reason to read its own device tokens back, and the only writer is the
-- SECURITY DEFINER RPC below. The future send-side job reads this table with
-- the service role, which bypasses RLS entirely.
revoke all on partner_push_tokens from public;


-- ---------------------------------------------------------------------------
-- register_partner_push_token — "this device belongs to me now."
--
-- Scoped to the caller's own partner the same way
-- mark_partner_notifications_read() (020) is: the partner id comes from
-- partner_users, never from the app.
-- ---------------------------------------------------------------------------

create or replace function register_partner_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  if p_token is null or trim(p_token) = '' then
    raise exception 'a push token is required' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  insert into partner_push_tokens (partner_id, token, platform)
  values (v_partner, trim(p_token), p_platform)
  on conflict (token) do update
    set partner_id = excluded.partner_id,
        platform = excluded.platform,
        last_seen_at = now();
end $$;

revoke all on function register_partner_push_token(text, text) from public;
grant execute on function register_partner_push_token(text, text) to authenticated;


-- Check: the table answers.
select count(*) as partner_push_tokens_rows from partner_push_tokens;
