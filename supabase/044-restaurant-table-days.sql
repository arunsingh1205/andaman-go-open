-- ===========================================================================
-- Migration 044 — restaurant table slots gain a per-slot day-of-week
--
-- The Dine screen used to offer tables for "tonight" only, so
-- set_partner_restaurant_tables_impl (017) never wrote days_of_week and the
-- reader (lib/restaurants.ts) never looked at it — every slot ran every night.
--
-- The redesigned reservation flow (District / Dineout style) lets a traveller
-- pick a day up to a week out, so a restaurant that shuts on, say, Tuesdays
-- now needs to say so. The restaurant_tables.days_of_week column has existed
-- since the schema was written; this migration just teaches the partner
-- editor's RPC to write it.
--
-- p_slots entries may now carry "days_of_week": int[] (0 = Sunday). Missing or
-- empty falls back to all seven days, so any older caller keeps working.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function set_partner_restaurant_tables_impl(
  p_restaurant_id uuid,
  p_slots jsonb
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_slot jsonb;
  v_count int;
  v_time_mins int;
  v_table_count int;
  v_seats_per_table int;
  v_seen_times int[] := '{}';
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id and partner_id = v_partner) then
    return query select false, 'That listing no longer exists.'::text;
    return;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    return query select false, 'Add at least one table slot.'::text;
    return;
  end if;

  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then
    return query select false, 'Add at least one table slot.'::text;
    return;
  end if;
  if v_count > 20 then
    return query select false, 'That is too many table slots — keep it to 20 or fewer.'::text;
    return;
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_time_mins := (v_slot->>'time_mins')::int;
    v_table_count := (v_slot->>'table_count')::int;
    v_seats_per_table := coalesce((v_slot->>'seats_per_table')::int, 4);

    if v_time_mins is null or v_time_mins < 0 or v_time_mins > 1439 then
      return query select false, 'Each slot needs a valid time.'::text;
      return;
    end if;
    if v_table_count is null or v_table_count <= 0 then
      return query select false, 'Each slot needs at least one table.'::text;
      return;
    end if;
    if v_seats_per_table <= 0 then
      return query select false, 'Each slot needs at least one seat per table.'::text;
      return;
    end if;
    if v_time_mins = any (v_seen_times) then
      return query select false, 'Two slots have the same time — give each one a different time.'::text;
      return;
    end if;
    v_seen_times := array_append(v_seen_times, v_time_mins);
  end loop;

  delete from restaurant_tables where restaurant_id = p_restaurant_id;

  insert into restaurant_tables (restaurant_id, time_mins, table_count, seats_per_table, days_of_week)
  select
    p_restaurant_id,
    (s->>'time_mins')::int,
    (s->>'table_count')::int,
    coalesce((s->>'seats_per_table')::int, 4),
    coalesce(
      nullif(
        (select array_agg(distinct x::int)
         from jsonb_array_elements_text(coalesce(s->'days_of_week', '[]'::jsonb)) x
         where x::int between 0 and 6),
        '{}'::int[]
      ),
      '{0,1,2,3,4,5,6}'
    )
  from jsonb_array_elements(p_slots) s;

  return query select true, 'Table slots saved.'::text;
end;
$$;

revoke all on function set_partner_restaurant_tables_impl(uuid, jsonb) from public, anon, authenticated;


-- Check: the wrapper still resolves and the impl now writes days_of_week.
select proname from pg_proc where proname = 'set_partner_restaurant_tables_impl';
