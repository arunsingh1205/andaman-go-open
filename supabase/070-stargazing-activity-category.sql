-- Stargazing as an activity category (2026-09-09).
--
-- Activities have been scuba / seawalk / snorkel / water since 004. The
-- Andamans have some of the darkest skies in the country, and a few
-- operators run guided night sessions — so this adds 'stargazing' as a
-- fifth category, everywhere the other four are named:
--   * the activities.category check constraint
--   * add_partner_activity_impl's own category guard (the wrapper in 027
--     just forwards, so only the _impl needs touching)
--
-- update_partner_activity doesn't take a category (013 froze it on edit),
-- so nothing to change there.

alter table activities drop constraint if exists activities_category_check;
alter table activities add constraint activities_category_check
  check (category in ('scuba', 'seawalk', 'snorkel', 'water', 'stargazing'));

create or replace function add_partner_activity_impl(
  p_category text,
  p_name text,
  p_summary text,
  p_about text,
  p_price_paise integer,
  p_photo_path text default null
) returns table(ok boolean, message text, activity_id uuid)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_partner uuid;
  v_island text;
  v_slug text;
  v_mark text;
  v_id uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if p_category not in ('scuba', 'seawalk', 'snorkel', 'water', 'stargazing') then
    return query select false, 'Choose a valid activity category.'::text, null::uuid;
    return;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return query select false, 'Give the activity a name.'::text, null::uuid;
    return;
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    return query select false, 'Enter a valid price.'::text, null::uuid;
    return;
  end if;

  select island_slug into v_island from partners where id = v_partner;
  v_mark := upper(substr(regexp_replace(p_name, '[^A-Za-z]', '', 'g') || 'XX', 1, 2));
  v_slug := unique_slug(p_name, 'activities');

  insert into activities (
    slug, partner_id, island_slug, category, mark, name, summary, about,
    price_paise, rating, reviews, is_listed, photo_path
  ) values (
    v_slug, v_partner, v_island, p_category, v_mark, trim(p_name),
    coalesce(trim(p_summary), ''), coalesce(trim(p_about), ''),
    p_price_paise, 0, 0, false, p_photo_path
  )
  returning id into v_id;

  return query select true, 'Added. It will appear once Andaman Go approves it.'::text, v_id;
end;
$$;

revoke all on function add_partner_activity_impl(text, text, text, text, integer, text) from public;
grant execute on function add_partner_activity_impl(text, text, text, text, integer, text) to service_role;


select 'stargazing activity category installed' as done;
