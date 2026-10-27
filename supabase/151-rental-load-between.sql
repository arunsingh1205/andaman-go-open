-- ===========================================================================
-- Migration 151 — per-date rental availability, not just today's
--
-- rental_load_on (043) answers "how many of this vehicle are out on ONE
-- day" — exactly what the shop list needed, and what the booking page used
-- to bake into Vehicle.available at page-load time. That was fine while
-- pick-up could only ever land on today or tomorrow; now the booking form
-- (147+) lets a traveller pick any date up to PICKUP_WINDOW_DAYS out
-- (lib/rentals.ts), and "available" kept showing today's load regardless of
-- which date was actually selected — a shop with 2 scooters both out today
-- read as sold out even for a booking three weeks away.
--
-- rental_load_between answers the same question across a range in one call,
-- so the booking page can fetch the whole window once and let the client
-- work out the real peak load for whatever (date, days) the traveller has
-- selected — the same peak-across-the-stay logic create_booking's own
-- 'rental' branch already runs at booking time, just readable ahead of
-- time instead of only enforced after the fact.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function rental_load_between(p_from date, p_to date)
returns table (variant_id uuid, on_date date, out_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.variant_id,
    ((i.starts_at at time zone 'Asia/Kolkata')::date + g.n) as on_date,
    count(*) as out_count
  from booking_items i
  cross join lateral generate_series(0, i.units - 1) as g(n)
  where i.kind = 'rental'
    and i.variant_id is not null
    and i.state in ('pending', 'confirmed', 'disrupted', 'completed')
    and ((i.starts_at at time zone 'Asia/Kolkata')::date + g.n) between p_from and p_to
  group by i.variant_id, ((i.starts_at at time zone 'Asia/Kolkata')::date + g.n);
$$;

revoke all on function rental_load_between(date, date) from public;
grant execute on function rental_load_between(date, date) to anon, authenticated;

select 'rental_load_between ready' as done;
