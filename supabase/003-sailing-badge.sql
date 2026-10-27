-- ===========================================================================
-- Migration 003 — a sailing's badge and its notice
--
-- The ferry card shows a badge ("Deluxe", "Popular") and a line of text under
-- the fare. Both were hardcoded in lib/ferries.ts. "Cheapest" and "Fastest" are
-- worked out from the fares and durations and stay in code — they are facts
-- about the list, not about one boat. The rest belongs to the operator, so it
-- moves into the database where an operator can eventually edit it.
--
-- This also records the seats already sold on tomorrow's sailings, so the
-- "Only 9 seats left" warning is a real subtraction rather than a sentence.
--
-- Safe to run more than once.
-- ===========================================================================

-- class_label was only ever used as the badge. Rename rather than add, so
-- there is no second column quietly holding the same idea.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sailings' and column_name = 'class_label'
  ) then
    alter table sailings rename column class_label to style_label;
  end if;
end $$;

alter table sailings add column if not exists style_tone text not null default 'plain'
  check (style_tone in ('good', 'warm', 'plain'));
alter table sailings add column if not exists info text not null default '';
alter table sailings add column if not exists info_warn boolean not null default false;

update sailings s
set style_label = v.style_label,
    style_tone  = v.style_tone,
    info        = v.info,
    info_warn   = v.info_warn
from (values
  ('gov',     'Standard', 'plain', 'Booked for you on STARS',    false),
  ('makruzz', 'Deluxe',   'plain', 'Window seats available',     false),
  ('green',   'Popular',  'warm',  '',                           false),
  ('nautika', 'Premium',  'plain', 'Sea gets choppy after 2 PM', true)
) as v(code, style_label, style_tone, info, info_warn)
where s.code = v.code;

-- Seats already gone on tomorrow's crossings. Green Ocean is the tight one.
insert into availability (kind, subject_id, starts_at, taken)
select 'ferry',
       s.id,
       ((current_date + 1) + make_interval(mins => s.dep_mins)) at time zone 'Asia/Kolkata',
       v.taken
from sailings s
join (values ('gov', 154), ('makruzz', 98), ('green', 111), ('nautika', 86))
  as v(code, taken) on v.code = s.code
on conflict (kind, subject_id, starts_at) do update set taken = excluded.taken;

-- Check: what the ferry list will show tomorrow.
select s.code, p.name as operator, s.style_label, s.style_tone, s.fare_paise,
       s.capacity - coalesce(a.taken, 0) as seats_left, s.info
from sailings s
join partners p on p.id = s.partner_id
left join availability a
  on a.kind = 'ferry' and a.subject_id = s.id
 and a.starts_at = ((current_date + 1) + make_interval(mins => s.dep_mins)) at time zone 'Asia/Kolkata'
order by s.fare_paise;
