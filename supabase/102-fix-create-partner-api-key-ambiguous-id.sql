-- ===========================================================================
-- Migration 102 — fix "column reference "id" is ambiguous" in
-- create_partner_api_key (099)
--
-- The function's RETURNS TABLE declares an output column named `id`, and
-- the INSERT's `returning id into v_id` was unqualified — Postgres couldn't
-- tell that from the api_keys table's own `id` column, so every attempt to
-- create a key failed with 42702 before ever inserting a row. Qualifying it
-- as `api_keys.id` is the only change.
--
-- Safe to run more than once.
-- ===========================================================================

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

select 'create_partner_api_key fixed' as done;
