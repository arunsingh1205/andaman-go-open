-- ===========================================================================
-- Migration 155 — first-party site traffic (who visits, and from where)
--
-- One row per page view, written by <VisitBeacon> through record_site_visit.
-- Source (Google / Instagram / WhatsApp / direct / a utm campaign), country,
-- state and city are worked out on the server before the insert, so this
-- table is ready to group by.
--
--   * site_visits has RLS on and no policies — nobody reads or writes it
--     directly. Writes go through record_site_visit (anon may call it);
--     reads go through admin_traffic (is_admin only).
--   * visitor_id is a random id kept in the browser (a returning person);
--     session_id is per tab-session. Neither is tied to an account.
--
-- Safe to run more than once.
-- ===========================================================================

create table if not exists site_visits (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  visitor_id   text not null,
  session_id   text not null,
  path         text not null,
  is_landing   boolean not null default false,
  source       text,
  medium       text,
  campaign     text,
  referrer     text,
  country      text,
  region       text,
  city         text,
  device       text,
  browser      text,
  os           text,
  is_app       boolean not null default false
);

create index if not exists site_visits_created_idx on site_visits (created_at desc);
create index if not exists site_visits_visitor_idx on site_visits (visitor_id, created_at);

alter table site_visits enable row level security;
revoke all on site_visits from public, anon, authenticated;


create or replace function record_site_visit(
  p_visitor_id text, p_session_id text, p_path text, p_is_landing boolean,
  p_source text, p_medium text, p_campaign text, p_referrer text,
  p_country text, p_region text, p_city text,
  p_device text, p_browser text, p_os text, p_is_app boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_visitor_id, '') = '' or coalesce(p_session_id, '') = '' or coalesce(p_path, '') = '' then
    return;
  end if;

  insert into site_visits (
    visitor_id, session_id, path, is_landing, source, medium, campaign, referrer,
    country, region, city, device, browser, os, is_app
  ) values (
    left(p_visitor_id, 64), left(p_session_id, 64), left(p_path, 200), coalesce(p_is_landing, false),
    left(p_source, 80), left(p_medium, 80), left(p_campaign, 120), left(p_referrer, 200),
    left(p_country, 8), left(p_region, 80), left(p_city, 80),
    left(p_device, 20), left(p_browser, 40), left(p_os, 40), coalesce(p_is_app, false)
  );
end;
$$;

revoke all on function record_site_visit(text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, boolean) from public;
grant execute on function record_site_visit(text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;


-- Everything the Traffic page shows, in one round trip. Days are IST days.
create or replace function admin_traffic(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  v_out   jsonb;
begin
  if not is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with v as (select * from site_visits where created_at >= v_since),
  firsts as (
    select visitor_id, min(created_at) as first_seen from site_visits group by visitor_id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'visitors',  count(distinct visitor_id),
        'sessions',  count(distinct session_id),
        'pageviews', count(*),
        'newVisitors', (select count(*) from firsts where first_seen >= v_since)
      ) from v),
    'daily', coalesce((select jsonb_agg(d order by d->>'day') from (
        select jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'),
                 'visitors', count(distinct v.visitor_id), 'pageviews', count(v.id)) as d
        from generate_series(
               ((now() at time zone 'Asia/Kolkata')::date - (v_days - 1))::timestamp,
               (now() at time zone 'Asia/Kolkata')::date::timestamp, interval '1 day') as g(day)
        left join v on (v.created_at at time zone 'Asia/Kolkata')::date = g.day::date
        group by g.day) x), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', coalesce(source, 'Direct'),
                 'visitors', count(distinct visitor_id), 'sessions', count(distinct session_id)) as s
        from v where is_landing group by coalesce(source, 'Direct') order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', campaign, 'source', coalesce(source, 'Direct'), 'medium', medium,
                 'visitors', count(distinct visitor_id)) as s
        from v where is_landing and campaign is not null
        group by campaign, source, medium order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', referrer, 'visitors', count(distinct visitor_id)) as s
        from v where is_landing and referrer is not null
        group by referrer order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', coalesce(country, '??'), 'visitors', count(distinct visitor_id)) as s
        from v group by coalesce(country, '??') order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'regions', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', region, 'country', country, 'visitors', count(distinct visitor_id)) as s
        from v where region is not null group by region, country order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', city, 'region', region, 'visitors', count(distinct visitor_id)) as s
        from v where city is not null group by city, region order by count(distinct visitor_id) desc limit 15) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(s order by (s->>'views')::int desc) from (
        select jsonb_build_object('name', path, 'views', count(*), 'visitors', count(distinct visitor_id)) as s
        from v group by path order by count(*) desc limit 15) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(s order by (s->>'visitors')::int desc) from (
        select jsonb_build_object('name', case when is_app then 'App' else coalesce(device, 'Unknown') end,
                 'visitors', count(distinct visitor_id)) as s
        from v group by case when is_app then 'App' else coalesce(device, 'Unknown') end
        order by count(distinct visitor_id) desc) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function admin_traffic(int) from public, anon;
grant execute on function admin_traffic(int) to authenticated;
