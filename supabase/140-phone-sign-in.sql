-- Migration 140 — make the traveller's phone a real auth identity
--
-- Until now "verify your number" (115) meant Twilio told us the code matched
-- and we stamped traveller_profiles.verified_at. The identity underneath was
-- still the anonymous account in that device's cookies, so a reinstall or a
-- second phone lost every booking — only the WhatsApp reference code got them
-- back. Supabase's own phone auth replaces that: updateUser({phone}) upgrades
-- the anonymous user *in place*, so auth.uid() never changes and the bookings
-- come along.
--
-- This migration adds the one guard that flow needs.
--
-- Supabase matches a phone-change OTP against auth.users.phone_change, and
-- that column is NOT unique. Two people (or one person twice) can start a
-- verification for the same number and leave it unfinished; the next
-- successful OTP updates the *first* matching row, which may belong to
-- somebody else entirely. On this app that would mean handing a stranger's
-- bookings to whoever signed in next. Supabase's own guidance is to clear
-- stale phone_change values from the application.
--
-- So: before starting a verification, the app clears abandoned attempts for
-- that number. Scoped to one number and to attempts older than the grace
-- period, so it can never interrupt a live one.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- One place for the normalisation that 007 and 115 each carry a copy of.
-- Bare Indian mobile -> +91, leading zero dropped, 91-prefixed tidied.
-- Returns null when the result still isn't a plausible E.164 number.
-- ---------------------------------------------------------------------------
create or replace function public.normalise_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_clean text;
begin
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');

  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;

  return v_clean;
end $function$;

-- ---------------------------------------------------------------------------
-- Clear abandoned phone_change attempts for one number.
--
-- auth.users.phone stores digits with no leading +, so both sides are reduced
-- to digits before comparing. The 15-minute floor is well past the 60-second
-- OTP expiry, so a verification somebody is actually in the middle of is
-- never touched — which is also why this is safe to expose to `authenticated`
-- rather than needing a cron job or the service role.
-- ---------------------------------------------------------------------------
create or replace function public.clear_stale_phone_change(p_phone text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_clean  text := public.normalise_phone(p_phone);
  v_digits text;
  v_rows   integer;
begin
  if v_clean is null then
    return 0;
  end if;

  v_digits := regexp_replace(v_clean, '[^0-9]', '', 'g');

  update auth.users
     set phone_change         = '',
         phone_change_token   = '',
         phone_change_sent_at = null
   where coalesce(phone_change, '') <> ''
     and regexp_replace(phone_change, '[^0-9]', '', 'g') = v_digits
     and (phone_change_sent_at is null
          or phone_change_sent_at < now() - interval '15 minutes');

  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;

revoke all on function public.normalise_phone(text) from public, anon;
revoke all on function public.clear_stale_phone_change(text) from public, anon;
grant execute on function public.normalise_phone(text) to authenticated;
grant execute on function public.clear_stale_phone_change(text) to authenticated;
