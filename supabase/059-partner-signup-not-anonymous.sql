-- Anonymous accounts can't register a business (2026-09-05).
--
-- The traveller side signs every visitor in anonymously the moment the app
-- opens (lib/supabase-browser.ts), so anybody who then taps through to
-- /partner is already `authenticated` as far as Postgres is concerned —
-- auth.uid() is a real uuid, it just isn't a person. register_partner only
-- checked `auth.uid() is null`, so that anonymous account could have created
-- a pending partners row and linked itself as owner.
--
-- The app now treats an anonymous account as signed-out on the partner side
-- and sends it to /partner/login, but the RPC is reachable on its own, so
-- the rule belongs here too. Supabase puts an `is_anonymous` claim in the
-- JWT; anything without a real identity behind it is turned away.
--
-- Body is otherwise carried over unchanged from 048-cab-service-schema.sql.

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

  v_slug := unique_slug(p_name, 'partners');

  insert into partners (slug, name, kind, island_slug, contact_phone, address, maps_url, status)
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(trim(p_contact_phone), ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending'
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;

revoke all on function register_partner(text, text, text, text, text, text) from public;
grant execute on function register_partner(text, text, text, text, text, text) to authenticated;


select 'partner signup guarded' as done;
