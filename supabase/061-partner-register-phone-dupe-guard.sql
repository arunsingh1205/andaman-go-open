-- A partner who signs in under a different Google account re-registers
-- instead of reattaching (2026-09-07).
--
-- partner_users links a business to a specific auth.users.id, not to a
-- person. If someone registers, signs out, and later comes back through
-- /partner/login → Google with a different account than the one they used
-- the first time (a second Gmail address, the account picker landing on the
-- wrong one — see login-form.tsx's `prompt: select_account`), that new
-- account has no partner_users row. getPartnerAuthState() reads that as
-- "unlinked" same as a first-time visitor, and register_partner happily
-- creates a second `partners` row for the same real business.
--
-- There's no reliable way to tell two Google accounts belong to the same
-- person from auth alone, so this doesn't try to auto-link. It closes the
-- one signal register_partner already collects that's actually stable
-- across accounts: the business's own contact phone. If a phone that's
-- already on file walks in on a second, unlinked account, that's almost
-- certainly the same business signing in wrong, not a new one — so this
-- stops the duplicate and points them back at the account they already
-- have instead of silently creating another `partners` row.
--
-- Phone cleaning is copied from set_partner_contact_phone (046) rather than
-- shared, because that function is scoped to an already-linked partner and
-- this runs before one exists. Comparing on the last 10 digits, not the
-- cleaned value verbatim, because 011/059 stored contact_phone as whatever
-- the partner typed — this is the first time it's normalized at
-- registration too, so older rows may still be un-prefixed.

create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null
) returns table (ok boolean, message text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_slug text;
  v_id uuid;
  v_phone_clean text;
  v_phone_last10 text;
  v_dupe_id uuid;
  v_dupe_name text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return query select
      false,
      'Sign in with Google before registering your business.'::text,
      null::uuid;
    return;
  end if;

  select pu.partner_id into v_existing from partner_users pu where pu.user_id = auth.uid();
  if v_existing is not null then
    return query select false, 'This account is already linked to a business.'::text, v_existing;
    return;
  end if;

  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Business name is required.'::text, null::uuid;
    return;
  end if;
  if p_kind not in ('dive', 'ferry', 'restaurant', 'rental', 'venue', 'host', 'cab') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;

  -- Same cleaning as set_partner_contact_phone (046): keep digits and a
  -- leading +, assume India when there's no country code.
  v_phone_clean := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9+]', '', 'g');
  if v_phone_clean ~ '^[6-9][0-9]{9}$' then
    v_phone_clean := '+91' || v_phone_clean;
  elsif v_phone_clean ~ '^91[6-9][0-9]{9}$' then
    v_phone_clean := '+' || v_phone_clean;
  end if;
  v_phone_last10 := right(regexp_replace(v_phone_clean, '[^0-9]', '', 'g'), 10);

  if v_phone_last10 <> '' then
    select p.id, p.name into v_dupe_id, v_dupe_name
    from partners p
    where right(regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g'), 10) = v_phone_last10
    limit 1;

    if v_dupe_id is not null then
      return query select
        false,
        format(
          'A business with this phone number is already registered (%s). If that''s you, sign out and sign back in with the Google account you used the first time. Message Andaman Go if you can''t get to it.',
          v_dupe_name
        ),
        v_dupe_id;
      return;
    end if;
  end if;

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (slug, name, kind, island_slug, contact_phone, address, maps_url, status)
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(v_phone_clean, ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending'
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;

revoke all on function register_partner(text, text, text, text, text, text) from public;
grant execute on function register_partner(text, text, text, text, text, text) to authenticated;


select 'partner register phone dupe guard installed' as done;
