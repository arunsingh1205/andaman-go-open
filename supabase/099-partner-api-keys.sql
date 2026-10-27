-- ===========================================================================
-- Migration 099 — a minimal partner API: push availability, pull bookings
--
-- A partner running their own booking system (a PMS, a spreadsheet-backed
-- tool, whatever) needs a way in and a way out, without Andaman Go building
-- a full two-way channel manager. v1 is deliberately one-way and small:
--   * push their own room-type availability/closures in
--   * pull bookings Andaman Go has taken for them out
--   * (the platform also calls OUT to the partner's own webhook right after
--     a booking, from lib/stay-webhook.ts — best-effort, with this pull
--     endpoint as the reliable fallback)
--
-- No API-key mechanism exists anywhere in this codebase yet (confirmed:
-- nothing matches api_key/apiKey/x-api-key outside an unrelated third-party
-- email API key). This is built from scratch, following the one crypto
-- convention this codebase already has (lib/razorpay.ts's HMAC signature
-- verification): the secret itself is generated and hashed in NODE
-- (lib/partner-api-keys.ts, SHA-256), never in Postgres — no new pgcrypto
-- dependency, and Postgres only ever sees a prefix + a hash to compare
-- against, the same "thin RPC, all the crypto happens in Node" shape
-- create_booking's Razorpay verification already uses.
--
-- Every external call bundles "verify this credential" and "do the thing"
-- into ONE security-definer RPC (api_push_stay_availability /
-- api_list_partner_bookings) rather than splitting verification from the
-- action — so there is never a moment where a caller-supplied partner_id is
-- trusted without the matching secret having just been checked in the same
-- transaction. Both are granted to `anon`, the same way create_booking and
-- the Razorpay webhook RPCs are: the credential (the API key) is the only
-- gate, not a Supabase session.
--
-- Safe to run more than once.
-- ===========================================================================


create table if not exists api_keys (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references partners(id) on delete cascade,
  label          text not null default '',
  key_prefix     text not null unique,
  key_hash       text not null,
  webhook_url    text,
  webhook_secret text,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists api_keys_partner_idx on api_keys (partner_id);

-- RLS enabled with NO select policy at all: key_hash and webhook_secret must
-- never be readable through PostgREST, by anyone, at any privilege level —
-- every read and write goes through a SECURITY DEFINER RPC below, each of
-- which returns only the columns that are safe to hand back.
alter table api_keys enable row level security;


-- ---------------------------------------------------------------------------
-- Partner self-service: create / list / revoke / set webhook URL. Node
-- (lib/partner-api-keys.ts) generates the raw secret and the webhook secret,
-- hashes the API secret with SHA-256, and only ever sends the prefix + hash
-- + webhook secret here — the raw API secret is shown to the partner once,
-- in the response to the create action, and never stored.
-- ---------------------------------------------------------------------------

create or replace function create_partner_api_key(
  p_label text, p_key_prefix text, p_key_hash text, p_webhook_secret text default null
) returns table (ok boolean, message text, id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_id      uuid;
begin
  perform assert_partner_owner();

  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_key_prefix), '') = '' or coalesce(trim(p_key_hash), '') = '' then
    raise exception 'a key prefix and hash are required' using errcode = '22023';
  end if;

  insert into api_keys (partner_id, label, key_prefix, key_hash, webhook_secret, created_by)
  values (v_partner, coalesce(trim(p_label), ''), p_key_prefix, p_key_hash, p_webhook_secret, auth.uid())
  returning api_keys.id into v_id;

  return query select true, 'Key created. Copy the secret now — it will not be shown again.'::text, v_id;
end $$;

revoke all on function create_partner_api_key(text, text, text, text) from public;
grant execute on function create_partner_api_key(text, text, text, text) to authenticated;


create or replace function list_partner_api_keys()
returns table (
  id uuid, label text, key_prefix text, webhook_url text,
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  return query
    select k.id, k.label, k.key_prefix, k.webhook_url, k.last_used_at, k.revoked_at, k.created_at
    from api_keys k
    where k.partner_id = v_partner
    order by k.created_at desc;
end $$;

revoke all on function list_partner_api_keys() from public;
grant execute on function list_partner_api_keys() to authenticated;


create or replace function revoke_partner_api_key(p_id uuid)
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

  update api_keys set revoked_at = now()
  where id = p_id and partner_id = v_partner and revoked_at is null;

  if not found then
    return query select false, 'That key no longer exists, or is already revoked.'::text;
    return;
  end if;

  return query select true, 'Key revoked.'::text;
end $$;

revoke all on function revoke_partner_api_key(uuid) from public;
grant execute on function revoke_partner_api_key(uuid) to authenticated;


create or replace function set_partner_api_webhook(p_id uuid, p_webhook_url text)
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

  update api_keys set webhook_url = nullif(trim(p_webhook_url), '')
  where id = p_id and partner_id = v_partner;

  if not found then
    return query select false, 'That key no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_api_webhook(uuid, text) from public;
grant execute on function set_partner_api_webhook(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The external-facing calls. Each verifies the (prefix, hash) pair against
-- api_keys inline — no separate "verify" step a caller could skip — updates
-- last_used_at, and only then does the actual work, scoped to that key's own
-- partner_id. Granted to anon: the API key is the credential, there is no
-- Supabase session here.
-- ---------------------------------------------------------------------------

create or replace function api_push_stay_availability(
  p_key_prefix text, p_key_hash text, p_room_type_code text, p_dates jsonb
) returns table (ok boolean, message text, nights_updated int)
language plpgsql security definer set search_path = public as $$
declare
  v_partner   uuid;
  v_stay_id   uuid;
  v_room_id   uuid;
  v_row       jsonb;
  v_date      date;
  v_available boolean;
  v_reason    text;
  v_count     int := 0;
begin
  select partner_id into v_partner
  from api_keys
  where key_prefix = p_key_prefix and key_hash = p_key_hash and revoked_at is null;

  if v_partner is null then
    return query select false, 'Invalid or revoked API key.'::text, 0;
    return;
  end if;

  update api_keys set last_used_at = now()
  where key_prefix = p_key_prefix and key_hash = p_key_hash;

  select rt.id, rt.stay_id into v_room_id, v_stay_id
  from stay_room_types rt
  join stays s on s.id = rt.stay_id
  where rt.code = p_room_type_code and s.partner_id = v_partner;

  if v_room_id is null then
    return query select false, 'That room type does not belong to this account.'::text, 0;
    return;
  end if;

  if p_dates is null or jsonb_typeof(p_dates) <> 'array' then
    return query select false, 'Send an array of dates.'::text, 0;
    return;
  end if;

  for v_row in select * from jsonb_array_elements(p_dates) loop
    v_date := nullif(v_row->>'date', '')::date;
    v_available := coalesce((v_row->>'available')::boolean, true);
    v_reason := nullif(trim(coalesce(v_row->>'reason', '')), '');

    if v_date is null then
      continue;
    end if;

    if v_available then
      delete from listing_closures
      where kind = 'stay' and subject_id = v_room_id and on_date = v_date;
    else
      insert into listing_closures (partner_id, kind, subject_id, on_date, reason)
      values (v_partner, 'stay', v_room_id, v_date, coalesce(v_reason, 'Closed via partner API'))
      on conflict (kind, subject_id, on_date) do update set reason = excluded.reason;
    end if;

    v_count := v_count + 1;
  end loop;

  return query select true, 'Availability updated.'::text, v_count;
end $$;

revoke all on function api_push_stay_availability(text, text, text, jsonb) from public;
grant execute on function api_push_stay_availability(text, text, text, jsonb) to anon, authenticated;


create or replace function api_list_partner_bookings(
  p_key_prefix text, p_key_hash text, p_since timestamptz default null, p_limit int default 50
) returns table (
  item_id uuid, kind text, ref_code text, ticket_code text, title text,
  room_type_code text, starts_at timestamptz, party int, units int,
  price_paise int, pay_mode text, paid_online_paise int, balance_paise int,
  state text, contact_phone text, contact_email text,
  booked_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select partner_id into v_partner
  from api_keys
  where key_prefix = p_key_prefix and key_hash = p_key_hash and revoked_at is null;

  if v_partner is null then
    return;
  end if;

  update api_keys set last_used_at = now()
  where key_prefix = p_key_prefix and key_hash = p_key_hash;

  return query
    select
      i.id, i.kind, b.ref_code, i.ticket_code, subject_title(i.kind, i.subject_id),
      rt.code, i.starts_at, i.party, i.units,
      i.price_paise, i.pay_mode, i.paid_online_paise, i.balance_paise,
      i.state, b.contact_phone, b.contact_email,
      b.created_at
    from booking_items i
    join bookings b on b.id = i.booking_id
    left join stay_room_types rt on rt.id = i.stay_room_type_id
    where i.partner_id = v_partner
      and (p_since is null or b.created_at > p_since)
    order by b.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function api_list_partner_bookings(text, text, timestamptz, int) from public;
grant execute on function api_list_partner_bookings(text, text, timestamptz, int) to anon, authenticated;


select 'partner API installed' as done;
