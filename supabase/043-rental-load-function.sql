-- ===========================================================================
-- Migration 043 — rental_load stops being a SECURITY DEFINER view
--
-- 035 made `rental_load` a view with `security_invoker = false` so a logged-out
-- traveller could read past booking_items' "your own rows only" RLS and see
-- that a scooter is sold out. That works, but Supabase's advisor flags every
-- SECURITY DEFINER view as a matter of course — and a standing CRITICAL lint is
-- worth clearing even when the case is benign (the view only ever exposed a
-- vehicle id and a count, never anything tied to a person).
--
-- The fix Supabase recommends: move the definer semantics into a FUNCTION. The
-- advisor doesn't flag `security definer` functions — they're the sanctioned
-- pattern, and this codebase already leans on them (create_booking,
-- sync_availability, reopen_partner_date). Same query, same data surface, same
-- anon access, no lint.
--
-- Safe to run more than once.
-- ===========================================================================

drop view if exists rental_load;

-- How many of each vehicle are out on a given day. One row per (vehicle, day)
-- with at least one out — numbers only, exactly what the catalogue needs to
-- grey out a sold-out vehicle before anyone taps Book.
create or replace function rental_load_on(p_date date)
returns table (variant_id uuid, out_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select i.variant_id, count(*) as out_count
  from booking_items i
  cross join lateral generate_series(0, i.units - 1) as g(n)
  where i.kind = 'rental'
    and i.variant_id is not null
    and i.state in ('pending', 'confirmed', 'disrupted', 'completed')
    and ((i.starts_at at time zone 'Asia/Kolkata')::date + g.n) = p_date
  group by i.variant_id;
$$;

revoke all on function rental_load_on(date) from public;
grant execute on function rental_load_on(date) to anon, authenticated;


-- Check: the function answers, and the flagged view is gone.
select count(*) as rental_load_rows from rental_load_on(current_date + 1);
select count(*) as leftover_view
from pg_views where schemaname = 'public' and viewname = 'rental_load';
