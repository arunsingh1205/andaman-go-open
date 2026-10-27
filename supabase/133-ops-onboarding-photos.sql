-- Cover photo + listing photos for ops-onboarded partners (131/132).
--
-- Storage itself doesn't need a new policy: uploads go through the
-- service-role client (lib/supabase-admin.ts, used from
-- app/ops/partner-onboarding/photo-upload.ts) rather than the partner's own
-- browser session, so the existing "partners manage own photos" RLS policy
-- on storage.objects (011) is simply bypassed the same way auth.admin.* is
-- for account creation — ops isn't in partner_users for a business it just
-- created, so it could never pass that policy directly.
--
-- These two RPCs are what let the already-uploaded paths actually get
-- attached to the partner/listing row, mirroring update_partner_profile's
-- cover-photo column and set_listing_photos (096) exactly, just gated by
-- is_ops() with an explicit p_partner_id instead of an auth.uid() lookup.

create or replace function ops_set_cover_photo(p_partner_id uuid, p_path text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_ops() then
    raise exception 'ops access required' using errcode = '42501';
  end if;

  update partners set cover_photo_path = p_path where id = p_partner_id;
  if not found then
    return query select false, 'That partner no longer exists.'::text;
    return;
  end if;

  return query select true, 'Saved.'::text;
end;
$$;

revoke all on function ops_set_cover_photo(uuid, text) from public;
grant execute on function ops_set_cover_photo(uuid, text) to authenticated;

create or replace function ops_set_listing_photos(p_kind text, p_partner_id uuid, p_id uuid, p_paths text[])
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_table text;
  v_cover text;
begin
  if not is_ops() then
    raise exception 'ops access required' using errcode = '42501';
  end if;

  v_table := case p_kind
    when 'activity' then 'activities' when 'rental' then 'vehicles'
    when 'cab' then 'cabs' when 'table' then 'restaurants'
    when 'event' then 'events' when 'trip' then 'trips'
    when 'ferry' then 'sailings' when 'stay' then 'stays' else null end;
  if v_table is null then
    return query select false, 'Unknown listing type.'::text;
    return;
  end if;

  v_owner := listing_partner_id(p_kind, p_id);
  if v_owner is null or v_owner <> p_partner_id then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  delete from listing_photos where listing_kind = p_kind and listing_id = p_id;

  insert into listing_photos (listing_kind, listing_id, storage_path, sort_order)
  select p_kind, p_id, t.path, t.ord - 1
  from unnest(coalesce(p_paths, '{}'::text[])) with ordinality as t(path, ord)
  where coalesce(trim(t.path), '') <> ''
  on conflict (listing_kind, listing_id, storage_path) do nothing;

  select storage_path into v_cover from listing_photos
    where listing_kind = p_kind and listing_id = p_id
    order by sort_order limit 1;

  execute format('update %I set photo_path = $1 where id = $2', v_table)
    using v_cover, p_id;

  return query select true, 'Saved.'::text;
end;
$$;

revoke all on function ops_set_listing_photos(text, uuid, uuid, text[]) from public;
grant execute on function ops_set_listing_photos(text, uuid, uuid, text[]) to authenticated;

select 'ops onboarding: cover + listing photo support added' as done;
