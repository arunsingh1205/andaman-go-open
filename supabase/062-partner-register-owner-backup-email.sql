-- A backup email for the account that isn't the one you signed up with
-- (2026-09-07). Follows 061 — that migration stops a second Google account
-- from silently re-registering the same business; this gives the owner a
-- way to avoid needing that guard in the first place.
--
-- register_partner links the business to whichever Google account is
-- signed in at the moment, and that's the only account that will ever open
-- it — there was no path back if that account became unreachable (lost
-- access, wrong account picked, phone lost with it as the only signed-in
-- device). This adds one optional field to registration: a second email.
-- If it's ever the one signed in on /partner/login, 026's existing invite
-- system already knows what to do with it — my_pending_invites() finds it,
-- and the not-linked screen already offers Accept. This migration only
-- creates that invite at registration time, pre-addressed to the owner
-- themselves, role 'owner' rather than 026's usual 'staff'.
--
-- Existing partners who registered before this migration don't get one
-- retroactively — there's no form for them to fill in yet. Follow-up if
-- that's wanted: let an owner invite themselves as 'owner' from Settings'
-- existing Team box (invite_partner_staff already accepts that role; only
-- the client hardcodes 'staff').

create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null,
  p_owner_email text default null
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
  v_owner_email text := lower(trim(coalesce(p_owner_email, '')));
  v_my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
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
  if v_owner_email <> '' and v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That backup email doesn''t look right.'::text, null::uuid;
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

  -- Pre-address an owner invite to the backup email, same table 026 already
  -- uses for staff — so if that email is ever the one signed in here, the
  -- not-linked screen's existing "you've been invited" branch picks it up.
  -- Skipped if it's blank or the same address that's already linked.
  if v_owner_email <> '' and v_owner_email <> v_my_email then
    insert into partner_invites (partner_id, email, role, invited_by)
    values (v_id, v_owner_email, 'owner', auth.uid());
  end if;

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;

revoke all on function register_partner(text, text, text, text, text, text, text) from public;
grant execute on function register_partner(text, text, text, text, text, text, text) to authenticated;

-- The old 6-arg signature is being replaced by the 7-arg one above, not
-- overloaded — drop it so the client can't accidentally call the version
-- with no dupe guard and no backup email.
drop function if exists register_partner(text, text, text, text, text, text);


select 'partner register owner backup email installed' as done;
