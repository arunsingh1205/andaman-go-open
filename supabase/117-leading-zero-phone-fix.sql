-- ===========================================================================
-- Migration 117 — recognise a leading 0 on an Indian mobile number (the old
-- STD-dialling habit — "09876543210" instead of "9876543210") wherever this
-- app cleans a phone number, not just the WhatsApp-number field that first
-- surfaced it ("Mango Stayys" typed exactly this and got rejected as
-- invalid). Every one of these functions already shares the same three-line
-- cleaning block by convention ("same cleaning as set_my_phone (007)") — one
-- more branch, added consistently everywhere, rather than leaving the fix
-- in a single spot and letting the same complaint resurface elsewhere.
--
-- New case: an 11-digit run starting with 0, where digits 2-11 already look
-- like a valid Indian mobile (0 + [6-9] + 9 digits) — strip the 0, then
-- treat it exactly like the bare-10-digit case. A genuine +91 number typed
-- with a stray leading 0 ("0" + "91XXXXXXXXXX", 13 digits) is left alone;
-- nobody actually dials it that way, and guessing wrong there is worse than
-- just asking them to fix it.
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
  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
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
  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
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


create or replace function set_partner_contact_phone(p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_clean   text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  -- Same cleaning as set_my_phone (007, 117): keep digits and a leading +,
  -- assume India when there's no country code, strip a stray leading 0.
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set contact_phone = nullif(v_clean, '') where id = v_partner;

  return query select true, 'Saved.'::text;
end $$;


create or replace function admin_set_partner_contact_phone(p_partner_id uuid, p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_clean text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  -- Same cleaning as set_partner_contact_phone (023, 117).
  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set contact_phone = nullif(v_clean, '') where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_contact_phone(uuid, text) from public;
grant execute on function admin_set_partner_contact_phone(uuid, text) to authenticated;


create or replace function admin_set_partner_whatsapp_number(p_partner_id uuid, p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_clean text;
begin
  if not is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;

  v_clean := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v_clean ~ '^0[6-9][0-9]{9}$' then
    v_clean := '+91' || substring(v_clean from 2);
  elsif v_clean ~ '^[6-9][0-9]{9}$' then
    v_clean := '+91' || v_clean;
  elsif v_clean ~ '^91[6-9][0-9]{9}$' then
    v_clean := '+' || v_clean;
  end if;

  if coalesce(v_clean, '') <> '' and v_clean !~ '^\+[1-9][0-9]{7,14}$' then
    return query select false, 'That doesn''t look like a phone number.'::text;
    return;
  end if;

  update partners set whatsapp_number = nullif(v_clean, '') where id = p_partner_id;
  if not found then
    return query select false, 'That business no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function admin_set_partner_whatsapp_number(uuid, text) from public;
grant execute on function admin_set_partner_whatsapp_number(uuid, text) to authenticated;


create or replace function register_partner(
  p_name text,
  p_kind text,
  p_island_slug text,
  p_contact_phone text,
  p_address text,
  p_maps_url text default null,
  p_owner_email text default null,
  p_terms_accepted boolean default false
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
  -- Bump this whenever the wording at /partner-agreement changes materially,
  -- and match LAST_UPDATED.partnerAgreement in app/(legal)/legal-meta.ts.
  -- 2026-09-13: Stays & Homestays launch, 20% commission (096/097).
  v_terms_version constant text := '2026-09-13';
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
  if p_kind not in ('dive', 'ferry', 'rental', 'venue', 'host', 'cab', 'stay') then
    return query select false, 'Choose a valid business category.'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from islands where slug = p_island_slug) then
    return query select false, 'Choose a valid island.'::text, null::uuid;
    return;
  end if;
  if not coalesce(p_terms_accepted, false) then
    return query select false, 'Please read and accept the Partner Agreement to register.'::text, null::uuid;
    return;
  end if;
  if v_owner_email <> '' and v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false, 'That backup email doesn''t look right.'::text, null::uuid;
    return;
  end if;

  v_phone_clean := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9+]', '', 'g');
  if v_phone_clean ~ '^0[6-9][0-9]{9}$' then
    v_phone_clean := '+91' || substring(v_phone_clean from 2);
  elsif v_phone_clean ~ '^[6-9][0-9]{9}$' then
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

  insert into partners (
    slug, name, kind, island_slug, contact_phone, address, maps_url, status,
    terms_accepted_at, terms_version
  )
  values (
    v_slug, trim(p_name), p_kind, p_island_slug,
    nullif(v_phone_clean, ''), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), 'pending',
    now(), v_terms_version
  )
  returning id into v_id;

  insert into partner_users (user_id, partner_id, role) values (auth.uid(), v_id, 'owner');

  if v_owner_email <> '' and v_owner_email <> v_my_email then
    insert into partner_invites (partner_id, email, role, invited_by)
    values (v_id, v_owner_email, 'owner', auth.uid());
  end if;

  return query select true, 'Registered. Add your first listing to get started.'::text, v_id;
end $$;


create or replace function create_ratecard_cab_booking(
  p_island_slug      text,
  p_from_place_id    uuid,
  p_to_place_id      uuid,
  p_trip_type        text,
  p_vehicle_category text,
  p_starts_at        timestamptz,
  p_traveller_name    text,
  p_traveller_phone   text,
  p_pickup_note      text default '',
  p_pay_mode         text default 'partial',
  p_razorpay_order_id   text default null,
  p_razorpay_payment_id text default null,
  p_pickup_lat        numeric default null,
  p_pickup_lng        numeric default null
)
returns table (
  ref_code text, ticket_code text, fare_paise int,
  paid_online_paise int, balance_paise int
)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_operator   uuid;
  v_fare       int;
  v_nights     int;
  v_bps        int;
  v_commission int;
  v_paid       int;
  v_balance    int;
  v_start_day  date := (p_starts_at at time zone 'Asia/Kolkata')::date;
  v_end_day    date;
  v_return_date date;
  v_days       int;
  v_booking    uuid;
  v_ref        text;
  v_ticket     text;
  v_item       uuid;
  v_name       text := nullif(trim(p_traveller_name), '');
  v_phone      text := regexp_replace(coalesce(p_traveller_phone, ''), '[^0-9+]', '', 'g');
  v_email      text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_trip_type not in ('oneway','roundtrip','outstation') then
    raise exception 'unknown trip type "%"', p_trip_type using errcode = '22023';
  end if;
  if p_vehicle_category not in ('hatchback','sedan','suv','tempo') then
    raise exception 'unknown vehicle category "%"', p_vehicle_category using errcode = '22023';
  end if;
  if p_pay_mode not in ('full','partial') then
    raise exception 'unknown payment mode "%"', p_pay_mode using errcode = '22023';
  end if;
  if p_pickup_lat is not null and (p_pickup_lat < -90 or p_pickup_lat > 90) then
    raise exception 'pickup latitude out of range' using errcode = '22023';
  end if;
  if p_pickup_lng is not null and (p_pickup_lng < -180 or p_pickup_lng > 180) then
    raise exception 'pickup longitude out of range' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'a name is required for this booking' using errcode = '22023';
  end if;

  -- Same cleaning as set_my_phone (007, 117): a bare Indian mobile gets
  -- +91, a stray leading 0 gets stripped first.
  if v_phone ~ '^0[6-9][0-9]{9}$' then
    v_phone := '+91' || substring(v_phone from 2);
  elsif v_phone ~ '^[6-9][0-9]{9}$' then
    v_phone := '+91' || v_phone;
  elsif v_phone ~ '^91[6-9][0-9]{9}$' then
    v_phone := '+' || v_phone;
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a phone number' using errcode = '22023';
  end if;

  -- Same retry shortcut as create_cab_booking: a repeat call carrying a
  -- payment id that already bought a booking returns that booking.
  if p_razorpay_payment_id is not null then
    select b.ref_code, bi.ticket_code, bi.price_paise,
           bi.paid_online_paise, bi.balance_paise
      into v_ref, v_ticket, v_fare, v_paid, v_balance
    from booking_items bi
    join bookings b on b.id = bi.booking_id
    where bi.razorpay_payment_id = p_razorpay_payment_id;

    if found then
      return query select v_ref, v_ticket, v_fare, v_paid, v_balance;
      return;
    end if;
  end if;

  select id into v_operator from partners where slug = 'andaman-go-cabs';
  if v_operator is null then
    raise exception 'the cab dispatch desk is not set up yet' using errcode = '22023';
  end if;

  if p_razorpay_payment_id is null then
    raise exception 'a verified payment is required for this booking' using errcode = '22023';
  end if;

  select fare_paise, nights into v_fare, v_nights
  from cab_rate_card
  where island_slug = p_island_slug
    and trip_type = p_trip_type
    and vehicle_category = p_vehicle_category
    and is_active
    and from_place_id is not distinct from p_from_place_id
    and to_place_id is not distinct from p_to_place_id;

  if v_fare is null and p_from_place_id is not null then
    select fare_paise, nights into v_fare, v_nights
    from cab_rate_card
    where island_slug = p_island_slug
      and trip_type = p_trip_type
      and vehicle_category = p_vehicle_category
      and is_active
      and from_place_id is null
      and to_place_id is not distinct from p_to_place_id;
  end if;

  if v_fare is null or v_fare <= 0 then
    raise exception 'no fare set for this trip' using errcode = '22023';
  end if;

  if p_trip_type = 'outstation' then
    v_days := greatest(coalesce(v_nights, 0) + 1, 1);
    v_end_day := v_start_day + (v_days - 1);
    v_return_date := v_end_day;
  else
    v_days := 1;
    v_end_day := v_start_day;
    v_return_date := null;
  end if;

  select bps into v_bps from commission_rates where kind = 'cab';
  v_bps := coalesce(v_bps, 1500);
  v_commission := round(v_fare * v_bps / 10000.0)::int;

  if p_pay_mode = 'full' then
    v_paid := v_fare; v_balance := 0;
  else
    v_paid := v_commission; v_balance := v_fare - v_commission;
  end if;

  select id into v_booking
  from bookings where user_id = v_user and on_date = v_start_day limit 1;

  if v_booking is null then
    v_ref := new_ref_code();
    select email into v_email from traveller_profiles where user_id = v_user;
    insert into bookings (ref_code, user_id, island_slug, on_date, contact_name, contact_phone, contact_email)
    values (v_ref, v_user, p_island_slug, v_start_day, v_name, v_phone, v_email)
    returning id into v_booking;
  else
    -- The traveller is telling us right now, at checkout, who to call for
    -- this trip — that always wins over whatever (if anything) was on the
    -- reference already.
    update bookings set contact_name = v_name, contact_phone = v_phone
    where id = v_booking
    returning ref_code into v_ref;
  end if;

  -- Worth remembering for next time, but never overwrite a number the
  -- traveller already has saved.
  update traveller_profiles set phone = coalesce(phone, v_phone) where user_id = v_user;

  insert into booking_items
    (booking_id, kind, subject_id, partner_id, starts_at,
     party, units, price_paise, pay_mode, paid_online_paise, balance_paise,
     state, razorpay_order_id, razorpay_payment_id)
  values
    (v_booking, 'cab', v_operator, v_operator, p_starts_at,
     1, 1, v_fare, p_pay_mode, v_paid, v_balance,
     'pending', p_razorpay_order_id, p_razorpay_payment_id)
  returning id into v_item;

  insert into cab_trip_details
    (item_id, trip_type, from_place_id, to_place_id, return_date, days, pickup_note,
     pickup_lat, pickup_lng)
  values
    (v_item, p_trip_type, p_from_place_id, p_to_place_id, v_return_date, v_days,
     coalesce(trim(p_pickup_note), ''), p_pickup_lat, p_pickup_lng);

  return query select v_ref, null::text, v_fare, v_paid, v_balance;
end $$;

select 'leading-zero phone numbers now recognised everywhere' as done;
