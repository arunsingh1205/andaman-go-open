-- ===========================================================================
-- Migration 027 — owner-only writes, enforced in the database
--
-- 026 gave a business staff members and hid the earnings / listings / settings
-- screens from them in the app. But the RPCs behind those screens only ever
-- checked that the caller was LINKED to the partner, not that they were the
-- OWNER — so a staff member who called them directly could still edit a
-- listing's price, change the payout account, or reply to a review.
--
-- This closes that. Rather than re-state ~20 large function bodies (and risk
-- a transcription bug in logic that already works), each owner-only RPC is
-- RENAMED to <name>_impl and given a thin wrapper of the same name that
-- calls assert_partner_owner() first. The wrapper is SECURITY DEFINER and
-- owns the right to call the (now locked-down) _impl; a staff member calling
-- either name gets refused.
--
-- Left open to staff on purpose — front-desk work, not owner-only:
--   confirm_booking / decline_booking / redeem_booking / look_up_booking,
--   partner_send_message / mark_booking_messages_read,
--   mark_partner_notifications_read.
--
-- Closing a date (close_partner_date / reopen_partner_date /
-- weather_close_partner) is owner-only too — it changes what travellers can
-- book, and a business that wants front desk to be able to shut a day for
-- weather can make that person a second owner.
--
-- Safe to run more than once.
-- ===========================================================================


create or replace function assert_partner_owner() returns void
language plpgsql stable set search_path = public as $$
begin
  if not exists (
    select 1 from partner_users
    where user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'only the business owner can do this' using errcode = '42501';
  end if;
end $$;

revoke all on function assert_partner_owner() from public;
grant execute on function assert_partner_owner() to authenticated;


-- ---------------------------------------------------------------------------
-- rename_and_wrap does the repetitive part: rename <fn>(<args>) to <fn>_impl
-- once, lock the _impl down, and (the caller then) create the wrapper.
--   p_sig   : argument type list, e.g. 'uuid, text, int'
-- ---------------------------------------------------------------------------

create or replace function _owner_wrap_prepare(p_fn text, p_sig text) returns void
language plpgsql as $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = p_fn || '_impl'
  ) then
    execute format('alter function public.%I(%s) rename to %I', p_fn, p_sig, p_fn || '_impl');
  end if;
  execute format(
    'revoke all on function public.%I(%s) from public, anon, authenticated',
    p_fn || '_impl', p_sig
  );
end $$;


-- ===========================================================================
-- Profile & contact
-- ===========================================================================

select _owner_wrap_prepare('update_partner_profile', 'text, text, text, text, text');
create or replace function update_partner_profile(
  p_address text, p_maps_url text, p_cover_photo_path text,
  p_license_number text, p_license_doc_path text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_profile_impl(
    p_address, p_maps_url, p_cover_photo_path, p_license_number, p_license_doc_path
  );
end $$;
grant execute on function update_partner_profile(text, text, text, text, text) to authenticated;

select _owner_wrap_prepare('set_partner_contact_phone', 'text');
create or replace function set_partner_contact_phone(p_phone text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_contact_phone_impl(p_phone);
end $$;
grant execute on function set_partner_contact_phone(text) to authenticated;

select _owner_wrap_prepare('set_partner_notification_prefs', 'boolean, boolean, boolean');
create or replace function set_partner_notification_prefs(
  p_new_booking boolean, p_cancellation boolean, p_message boolean
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_notification_prefs_impl(
    p_new_booking, p_cancellation, p_message
  );
end $$;
grant execute on function set_partner_notification_prefs(boolean, boolean, boolean) to authenticated;

select _owner_wrap_prepare('set_payout_account', 'text, text, text, text');
create or replace function set_payout_account(
  p_account_name text, p_account_number text, p_ifsc text, p_upi_id text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from set_payout_account_impl(
    p_account_name, p_account_number, p_ifsc, p_upi_id
  );
end $$;
grant execute on function set_payout_account(text, text, text, text) to authenticated;


-- ===========================================================================
-- Reviews
-- ===========================================================================

select _owner_wrap_prepare('reply_to_review', 'uuid, text');
create or replace function reply_to_review(p_review_id uuid, p_reply text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from reply_to_review_impl(p_review_id, p_reply);
end $$;
grant execute on function reply_to_review(uuid, text) to authenticated;


-- ===========================================================================
-- Resubmit after rejection
-- ===========================================================================

select _owner_wrap_prepare('resubmit_partner', '');
create or replace function resubmit_partner()
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from resubmit_partner_impl();
end $$;
grant execute on function resubmit_partner() to authenticated;

select _owner_wrap_prepare('resubmit_partner_listing', 'text, uuid');
create or replace function resubmit_partner_listing(p_kind text, p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from resubmit_partner_listing_impl(p_kind, p_id);
end $$;
grant execute on function resubmit_partner_listing(text, uuid) to authenticated;


-- ===========================================================================
-- Schedules
-- ===========================================================================

select _owner_wrap_prepare('set_partner_activity_schedule', 'uuid, jsonb');
create or replace function set_partner_activity_schedule(p_activity_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_activity_schedule_impl(p_activity_id, p_slots);
end $$;
grant execute on function set_partner_activity_schedule(uuid, jsonb) to authenticated;

select _owner_wrap_prepare('set_partner_restaurant_tables', 'uuid, jsonb');
create or replace function set_partner_restaurant_tables(p_restaurant_id uuid, p_slots jsonb)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from set_partner_restaurant_tables_impl(p_restaurant_id, p_slots);
end $$;
grant execute on function set_partner_restaurant_tables(uuid, jsonb) to authenticated;


-- ===========================================================================
-- Add a listing  (wrappers return the extra <kind>_id column)
-- ===========================================================================

select _owner_wrap_prepare('add_partner_activity', 'text, text, text, text, int, text');
create or replace function add_partner_activity(
  p_category text, p_name text, p_summary text, p_about text,
  p_price_paise int, p_photo_path text default null
) returns table (ok boolean, message text, activity_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_activity_impl(
    p_category, p_name, p_summary, p_about, p_price_paise, p_photo_path
  );
end $$;
grant execute on function add_partner_activity(text, text, text, text, int, text) to authenticated;

select _owner_wrap_prepare('add_partner_vehicle', 'text, text, int, int, text, int, text');
create or replace function add_partner_vehicle(
  p_type text, p_model text, p_rate_paise int, p_seats int, p_meta text,
  p_units int, p_photo_path text default null
) returns table (ok boolean, message text, vehicle_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_vehicle_impl(
    p_type, p_model, p_rate_paise, p_seats, p_meta, p_units, p_photo_path
  );
end $$;
grant execute on function add_partner_vehicle(text, text, int, int, text, int, text) to authenticated;

select _owner_wrap_prepare('add_partner_stay', 'text, text, text, int, text, text, text[], text');
create or replace function add_partner_stay(
  p_type text, p_name text, p_area text, p_price_paise int, p_blurb text,
  p_about text, p_amenities text[] default '{}', p_photo_path text default null
) returns table (ok boolean, message text, stay_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_stay_impl(
    p_type, p_name, p_area, p_price_paise, p_blurb, p_about, p_amenities, p_photo_path
  );
end $$;
grant execute on function add_partner_stay(text, text, text, int, text, text, text[], text) to authenticated;

select _owner_wrap_prepare('add_partner_restaurant', 'text, text, text, int, text, text, text');
create or replace function add_partner_restaurant(
  p_category text, p_name text, p_area text, p_price_tier int,
  p_blurb text, p_about text, p_photo_path text default null
) returns table (ok boolean, message text, restaurant_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_restaurant_impl(
    p_category, p_name, p_area, p_price_tier, p_blurb, p_about, p_photo_path
  );
end $$;
grant execute on function add_partner_restaurant(text, text, text, int, text, text, text) to authenticated;

select _owner_wrap_prepare('add_partner_event', 'text, text, text, text, date, int, int, int, text, text');
create or replace function add_partner_event(
  p_genre text, p_name text, p_venue text, p_area text, p_on_date date,
  p_time_mins int, p_entry_paise int, p_capacity int, p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text, event_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_event_impl(
    p_genre, p_name, p_venue, p_area, p_on_date, p_time_mins, p_entry_paise,
    p_capacity, p_about, p_photo_path
  );
end $$;
grant execute on function add_partner_event(text, text, text, text, date, int, int, int, text, text) to authenticated;

select _owner_wrap_prepare('add_partner_trip', 'text, text, text, text, int[], int, int, int, int, text, text[], text, text');
create or replace function add_partner_trip(
  p_title text, p_host_name text, p_host_since text, p_duration_label text,
  p_runs_on_days int[], p_price_paise int, p_deposit_paise int, p_min_seats int,
  p_seats_total int, p_summary text, p_includes text[] default '{}',
  p_meet_point text default '', p_photo_path text default null
) returns table (ok boolean, message text, trip_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_trip_impl(
    p_title, p_host_name, p_host_since, p_duration_label, p_runs_on_days,
    p_price_paise, p_deposit_paise, p_min_seats, p_seats_total, p_summary,
    p_includes, p_meet_point, p_photo_path
  );
end $$;
grant execute on function add_partner_trip(text, text, text, text, int[], int, int, int, int, text, text[], text, text) to authenticated;

select _owner_wrap_prepare('add_partner_sailing', 'text, text, text, int, int, int, int, int[], text, text, boolean, text');
create or replace function add_partner_sailing(
  p_from_island text, p_to_island text, p_style_label text, p_dep_mins int,
  p_duration_mins int, p_fare_paise int, p_capacity int, p_days_of_week int[],
  p_style_tone text default 'plain', p_info text default '',
  p_info_warn boolean default false, p_photo_path text default null
) returns table (ok boolean, message text, sailing_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from add_partner_sailing_impl(
    p_from_island, p_to_island, p_style_label, p_dep_mins, p_duration_mins,
    p_fare_paise, p_capacity, p_days_of_week, p_style_tone, p_info,
    p_info_warn, p_photo_path
  );
end $$;
grant execute on function add_partner_sailing(text, text, text, int, int, int, int, int[], text, text, boolean, text) to authenticated;


-- ===========================================================================
-- Edit a listing
-- ===========================================================================

select _owner_wrap_prepare('update_partner_activity', 'uuid, text, text, text, int, text');
create or replace function update_partner_activity(
  p_id uuid, p_name text, p_summary text, p_about text,
  p_price_paise int, p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_activity_impl(
    p_id, p_name, p_summary, p_about, p_price_paise, p_photo_path
  );
end $$;
grant execute on function update_partner_activity(uuid, text, text, text, int, text) to authenticated;

select _owner_wrap_prepare('update_partner_vehicle', 'uuid, text, int, int, text, int, text');
create or replace function update_partner_vehicle(
  p_id uuid, p_model text, p_rate_paise int, p_seats int, p_meta text,
  p_units int, p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_vehicle_impl(
    p_id, p_model, p_rate_paise, p_seats, p_meta, p_units, p_photo_path
  );
end $$;
grant execute on function update_partner_vehicle(uuid, text, int, int, text, int, text) to authenticated;

select _owner_wrap_prepare('update_partner_stay', 'uuid, text, text, int, text, text, text[], text');
create or replace function update_partner_stay(
  p_id uuid, p_name text, p_area text, p_price_paise int, p_blurb text,
  p_about text, p_amenities text[] default '{}', p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_stay_impl(
    p_id, p_name, p_area, p_price_paise, p_blurb, p_about, p_amenities, p_photo_path
  );
end $$;
grant execute on function update_partner_stay(uuid, text, text, int, text, text, text[], text) to authenticated;

select _owner_wrap_prepare('update_partner_restaurant', 'uuid, text, text, int, text, text, text');
create or replace function update_partner_restaurant(
  p_id uuid, p_name text, p_area text, p_price_tier int,
  p_blurb text, p_about text, p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_restaurant_impl(
    p_id, p_name, p_area, p_price_tier, p_blurb, p_about, p_photo_path
  );
end $$;
grant execute on function update_partner_restaurant(uuid, text, text, int, text, text, text) to authenticated;

select _owner_wrap_prepare('update_partner_event', 'uuid, text, text, text, date, int, int, int, text, text');
create or replace function update_partner_event(
  p_id uuid, p_name text, p_venue text, p_area text, p_on_date date,
  p_time_mins int, p_entry_paise int, p_capacity int, p_about text,
  p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_event_impl(
    p_id, p_name, p_venue, p_area, p_on_date, p_time_mins, p_entry_paise,
    p_capacity, p_about, p_photo_path
  );
end $$;
grant execute on function update_partner_event(uuid, text, text, text, date, int, int, int, text, text) to authenticated;

select _owner_wrap_prepare('update_partner_trip', 'uuid, text, text, text, text, int[], int, int, int, int, text, text[], text, text');
create or replace function update_partner_trip(
  p_id uuid, p_title text, p_host_name text, p_host_since text, p_duration_label text,
  p_runs_on_days int[], p_price_paise int, p_deposit_paise int, p_min_seats int,
  p_seats_total int, p_summary text, p_includes text[] default '{}',
  p_meet_point text default '', p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_trip_impl(
    p_id, p_title, p_host_name, p_host_since, p_duration_label, p_runs_on_days,
    p_price_paise, p_deposit_paise, p_min_seats, p_seats_total, p_summary,
    p_includes, p_meet_point, p_photo_path
  );
end $$;
grant execute on function update_partner_trip(uuid, text, text, text, text, int[], int, int, int, int, text, text[], text, text) to authenticated;

select _owner_wrap_prepare('update_partner_sailing', 'uuid, text, int, int, int, int, int[], text, text, boolean, text');
create or replace function update_partner_sailing(
  p_id uuid, p_style_label text, p_dep_mins int, p_duration_mins int,
  p_fare_paise int, p_capacity int, p_days_of_week int[],
  p_style_tone text default 'plain', p_info text default '',
  p_info_warn boolean default false, p_photo_path text default null
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from update_partner_sailing_impl(
    p_id, p_style_label, p_dep_mins, p_duration_mins, p_fare_paise, p_capacity,
    p_days_of_week, p_style_tone, p_info, p_info_warn, p_photo_path
  );
end $$;
grant execute on function update_partner_sailing(uuid, text, int, int, int, int, int[], text, text, boolean, text) to authenticated;


-- ===========================================================================
-- Closing a date
-- ===========================================================================

select _owner_wrap_prepare('close_partner_date', 'text, uuid, date, text');
create or replace function close_partner_date(
  p_kind text, p_subject_id uuid, p_on_date date, p_reason text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from close_partner_date_impl(p_kind, p_subject_id, p_on_date, p_reason);
end $$;
grant execute on function close_partner_date(text, uuid, date, text) to authenticated;

select _owner_wrap_prepare('reopen_partner_date', 'text, uuid, date');
create or replace function reopen_partner_date(
  p_kind text, p_subject_id uuid, p_on_date date
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from reopen_partner_date_impl(p_kind, p_subject_id, p_on_date);
end $$;
grant execute on function reopen_partner_date(text, uuid, date) to authenticated;

select _owner_wrap_prepare('weather_close_partner', 'date, text');
create or replace function weather_close_partner(p_on_date date, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_partner_owner();
  return query select * from weather_close_partner_impl(p_on_date, p_reason);
end $$;
grant execute on function weather_close_partner(date, text) to authenticated;


drop function if exists _owner_wrap_prepare(text, text);


-- Check: a staff member is now refused. (Run as a linked staff account:
--   select * from update_partner_profile('x','x',null,null,null);
-- should raise 'only the business owner can do this'.)
select 'owner-only writes locked' as done;
