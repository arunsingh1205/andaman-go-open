-- ===========================================================================
-- Migration 115 — traveller phone OTP verification, via Twilio Verify.
--
-- traveller_profiles.verified_at has existed since 007-contact-phone.sql,
-- reserved for exactly this ("OTP verification comes later"). Two changes:
--
--   1. set_my_phone now clears verified_at whenever the phone number
--      actually changes on save — an old verification must never appear to
--      cover a new number. (Re-saving the SAME number, e.g. re-submitting
--      the same form, keeps whatever verified_at it already had.)
--
--   2. mark_my_phone_verified — called from lib/phone-otp.ts only AFTER
--      Twilio's Verify API has already confirmed the code server-side. It
--      re-checks the phone still matches what's on file before stamping
--      verified_at, so a number that changed between "code sent" and "code
--      checked" can't end up marked verified under the old value.
--
-- Verification happens once, right after a number is added or changed (the
-- confirmation-screen prompt, app/phone-prompt.tsx) — not on every visit.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function set_my_phone(p_phone text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_clean text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a phone number' using errcode = '22023';
  end if;

  insert into traveller_profiles (user_id, phone, verified_at)
  values (v_user, v_clean, null)
  on conflict (user_id) do update
    set phone = excluded.phone,
        verified_at = case
          when traveller_profiles.phone = excluded.phone then traveller_profiles.verified_at
          else null
        end;

  update bookings
  set contact_phone = v_clean
  where user_id = v_user and contact_phone is null;

  return v_clean;
end $$;

revoke all on function set_my_phone(text) from public;
grant execute on function set_my_phone(text) to authenticated, anon;


create or replace function mark_my_phone_verified(p_phone text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_clean text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  update traveller_profiles
  set verified_at = now()
  where user_id = v_user and phone = v_clean;

  return found;
end $$;

revoke all on function mark_my_phone_verified(text) from public;
grant execute on function mark_my_phone_verified(text) to authenticated, anon;

select 'traveller phone otp verification wired up' as done;
