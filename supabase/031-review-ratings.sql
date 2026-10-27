-- ===========================================================================
-- Migration 031 — real reviews move the rating, and travellers can read them
--
-- 024 collected reviews but nothing consumed them: activities.rating and
-- friends still show the seed number typed into schema.sql, and only the
-- reviewer and the operator could read a review's text.
--
-- Two pieces:
--
--   seed_rating / seed_reviews + recompute_listing_rating() — the same move
--     availability.baseline (004) made: freeze the seeded number, then show
--     seed blended with real reviews. A listing with 120 seed reviews at 4.8
--     and two real 4.0s reads 4.79 (122); a self-served listing that started
--     at 0/0 reads its first real review straight.
--
--   listing_reviews(kind, slug) — a SECURITY DEFINER read that resolves the
--     slug itself (same seven-branch shape as record_listing_view) and hands
--     back only rating / body / reply / date. The reviews table stays locked;
--     user_id and item_id never leave it.
--
-- Ferries have no rating column anywhere and aren't reviewable — skipped.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Freeze the seeded numbers.
-- ---------------------------------------------------------------------------

alter table activities  add column if not exists seed_rating numeric(2,1);
alter table activities  add column if not exists seed_reviews int not null default 0;
alter table restaurants add column if not exists seed_rating numeric(2,1);
alter table restaurants add column if not exists seed_reviews int not null default 0;
alter table events      add column if not exists seed_rating numeric(2,1);
alter table events      add column if not exists seed_reviews int not null default 0;
alter table trips       add column if not exists seed_rating numeric(2,1);
alter table trips       add column if not exists seed_reviews int not null default 0;
alter table stays       add column if not exists seed_rating numeric(2,1);
alter table stays       add column if not exists seed_reviews int not null default 0;
alter table partners    add column if not exists seed_rating numeric(2,1);
alter table partners    add column if not exists seed_reviews int not null default 0;

-- One-time backfill: whatever the rating is right now IS the seed. Guarded on
-- seed_rating still being null so a re-run never re-freezes a blended value.
update activities  set seed_rating = rating, seed_reviews = reviews where seed_rating is null;
update restaurants set seed_rating = rating, seed_reviews = reviews where seed_rating is null;
update events      set seed_rating = rating, seed_reviews = reviews where seed_rating is null;
update trips       set seed_rating = rating, seed_reviews = reviews where seed_rating is null;
update stays       set seed_rating = rating, seed_reviews = reviews where seed_rating is null;
update partners    set seed_rating = rating, seed_reviews = reviews where seed_rating is null;


-- ---------------------------------------------------------------------------
-- recompute_listing_rating — after any change to a review, re-blend the
-- affected listing. Recount from scratch rather than adjust, same discipline
-- as sync_availability (004): an increment that runs twice is wrong forever;
-- a recount is right again next time.
-- ---------------------------------------------------------------------------

create or replace function recompute_listing_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind    text := coalesce(new.kind, old.kind);
  v_subject uuid := coalesce(new.subject_id, old.subject_id);
  v_seed_r  numeric;
  v_seed_c  int;
  v_real_sum bigint;
  v_real_cnt int;
  v_total   int;
  v_blend   numeric;
begin
  select coalesce(sum(rating), 0), count(*)
    into v_real_sum, v_real_cnt
  from reviews where kind = v_kind and subject_id = v_subject;

  if v_kind = 'activity' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from activities where id = v_subject;
  elsif v_kind = 'table' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from restaurants where id = v_subject;
  elsif v_kind = 'event' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from events where id = v_subject;
  elsif v_kind = 'trip' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from trips where id = v_subject;
  elsif v_kind = 'stay' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from stays where id = v_subject;
  elsif v_kind = 'rental' then
    select seed_rating, seed_reviews into v_seed_r, v_seed_c from partners where id = v_subject;
  else
    return null;
  end if;

  v_seed_r := coalesce(v_seed_r, 0);
  v_seed_c := coalesce(v_seed_c, 0);
  v_total  := v_seed_c + v_real_cnt;

  if v_total = 0 then
    return null;  -- nothing to say; leave the row as it is
  end if;

  v_blend := round((v_seed_r * v_seed_c + v_real_sum) / v_total, 1);

  if v_kind = 'activity' then
    update activities set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'table' then
    update restaurants set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'event' then
    update events set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'trip' then
    update trips set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'stay' then
    update stays set rating = v_blend, reviews = v_total where id = v_subject;
  elsif v_kind = 'rental' then
    update partners set rating = v_blend, reviews = v_total where id = v_subject;
  end if;

  return null;
end $$;

drop trigger if exists reviews_recompute_rating on reviews;
create trigger reviews_recompute_rating
after insert or update or delete on reviews
for each row execute function recompute_listing_rating();


-- ---------------------------------------------------------------------------
-- listing_reviews — the public read.
-- ---------------------------------------------------------------------------

create or replace function listing_reviews(p_kind text, p_subject text)
returns table (rating int, body text, reply text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  case p_kind
    when 'activity' then select id into v_id from activities where slug = p_subject;
    when 'table'    then select id into v_id from restaurants where slug = p_subject;
    when 'event'    then select id into v_id from events where slug = p_subject;
    when 'trip'     then select id into v_id from trips where slug = p_subject;
    when 'stay'     then select id into v_id from stays where slug = p_subject;
    when 'rental'   then select id into v_id from partners where slug = p_subject;
    else return;
  end case;

  if v_id is null then
    return;
  end if;

  return query
    select r.rating, r.body, r.reply, r.created_at
    from reviews r
    where r.kind = p_kind and r.subject_id = v_id
    order by r.created_at desc;
end $$;

revoke all on function listing_reviews(text, text) from public;
grant execute on function listing_reviews(text, text) to anon, authenticated;


-- One-off: blend anything that already has real reviews (024 shipped before
-- this trigger existed).
do $$
declare r record;
begin
  for r in select distinct kind, subject_id from reviews loop
    update reviews set subject_id = subject_id
    where kind = r.kind and subject_id = r.subject_id;  -- touch → fires the trigger
  end loop;
end $$;


-- Check: seeds are frozen.
select
  (select count(*) from activities where seed_rating is not null) as activities_seeded,
  (select count(*) from stays where seed_rating is not null) as stays_seeded;
