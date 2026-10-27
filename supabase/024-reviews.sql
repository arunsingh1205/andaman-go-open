-- ===========================================================================
-- Migration 024 — reviews
--
-- Every rating in the app so far is a seed number typed into schema.sql. This
-- is the real thing: a traveller who was actually checked in for a booking
-- can rate it 1–5 and leave a line, and the operator sees it and can post one
-- public reply.
--
-- SCOPE: this slice collects and shows reviews. It does NOT yet fold them
-- into the public catalogue rating — activities.rating and friends stay on
-- their seed values for now. Reconciling the two (seed average + real
-- reviews, the way availability.baseline blends with real bookings) is a
-- follow-up once there are enough real reviews for the blend to mean
-- something.
--
-- Ferries are not reviewable — there's no rating column anywhere for a
-- sailing, and nobody writes a Yelp review of the government ferry.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The reviews.
-- ---------------------------------------------------------------------------

create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  -- One review per checked-in booking item. Denormalised booking_id / user_id
  -- / partner_id / kind / subject_id so neither RLS nor the partner's list
  -- has to join back through booking_items.
  item_id     uuid not null references booking_items(id) on delete cascade,
  booking_id  uuid not null references bookings(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  kind        text not null check (kind in
                ('activity', 'table', 'event', 'trip', 'stay', 'rental')),
  subject_id  uuid not null,
  rating      int not null check (rating between 1 and 5),
  body        text,
  reply       text,
  replied_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (item_id)
);

create index if not exists reviews_subject_idx on reviews (kind, subject_id);
create index if not exists reviews_partner_idx on reviews (partner_id);

alter table reviews enable row level security;

-- Scoped reads only: the traveller sees their own reviews (so my_bookings can
-- show "you rated this"), the operator sees reviews of its own listings (the
-- Reviews tab). A blanket-public policy for the catalogue — with a column-
-- narrowed view that hides user_id / item_id — comes with the catalogue
-- integration in a later slice. Writes go through the two RPCs below.
drop policy if exists "reviews are public" on reviews;

drop policy if exists "traveller sees own reviews" on reviews;
create policy "traveller sees own reviews" on reviews
  for select using (user_id = auth.uid());

drop policy if exists "partner sees reviews of its listings" on reviews;
create policy "partner sees reviews of its listings" on reviews
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = reviews.partner_id and pu.user_id = auth.uid()
    )
  );

-- anon holds no session, so the scoped policies above give it zero rows; the
-- grant just keeps my_bookings (which anon may call) from tripping a
-- table-privilege check on its reviews subquery.
grant select on reviews to anon, authenticated;


-- ---------------------------------------------------------------------------
-- leave_review — the traveller, after being checked in.
-- ---------------------------------------------------------------------------

create or replace function leave_review(p_item_id uuid, p_rating int, p_body text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_booking  uuid;
  v_partner  uuid;
  v_kind     text;
  v_subject  uuid;
  v_redeemed timestamptz;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'Pick a rating from 1 to 5.'::text;
    return;
  end if;

  select i.booking_id, i.partner_id, i.kind, i.subject_id, i.redeemed_at
    into v_booking, v_partner, v_kind, v_subject, v_redeemed
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user;

  if v_booking is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;

  if v_kind = 'ferry' then
    return query select false, 'Ferry crossings can''t be reviewed.'::text;
    return;
  end if;

  if v_redeemed is null then
    return query select false, 'You can review this once the operator has checked you in.'::text;
    return;
  end if;

  insert into reviews (item_id, booking_id, user_id, partner_id, kind, subject_id, rating, body)
  values (p_item_id, v_booking, v_user, v_partner, v_kind, v_subject, p_rating,
          nullif(trim(p_body), ''))
  on conflict (item_id) do update set
    rating     = excluded.rating,
    body       = excluded.body,
    created_at = now();

  return query select true, 'Thanks — your review is in.'::text;
end $$;

revoke all on function leave_review(uuid, int, text) from public;
grant execute on function leave_review(uuid, int, text) to authenticated;


-- ---------------------------------------------------------------------------
-- reply_to_review — the operator, once.
-- ---------------------------------------------------------------------------

create or replace function reply_to_review(p_review_id uuid, p_reply text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_owner   uuid;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select partner_id into v_owner from reviews where id = p_review_id;
  if v_owner is null or v_owner <> v_partner then
    return query select false, 'Review not found.'::text;
    return;
  end if;

  if coalesce(trim(p_reply), '') = '' then
    update reviews set reply = null, replied_at = null where id = p_review_id;
    return query select true, 'Reply removed.'::text;
    return;
  end if;

  update reviews
  set reply = trim(p_reply), replied_at = now()
  where id = p_review_id;

  return query select true, 'Reply posted.'::text;
end $$;

revoke all on function reply_to_review(uuid, text) from public;
grant execute on function reply_to_review(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- A new review rings the partner's bell (020). Always on — there's no
-- notify_review preference yet; that can join the 023 switches later.
-- ---------------------------------------------------------------------------

alter table partner_notifications drop constraint if exists partner_notifications_kind_check;
alter table partner_notifications add constraint partner_notifications_kind_check
  check (kind in ('booking_new', 'booking_cancelled', 'booking_disrupted', 'booking_message', 'review'));

create or replace function notify_partner_of_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  -- Only a brand-new review, not an edit.
  if TG_OP <> 'INSERT' then
    return null;
  end if;

  v_title := coalesce(subject_title(new.kind, new.subject_id), 'A listing');

  insert into partner_notifications (partner_id, kind, title, body, item_id)
  values (
    new.partner_id,
    'review',
    new.rating || '★ review',
    v_title || (case when new.body is not null then ' — ' ||
      (case when length(new.body) > 90 then left(new.body, 90) || '…' else new.body end)
      else '' end),
    new.item_id
  );

  return null;
end $$;

drop trigger if exists reviews_notify_partner on reviews;
create trigger reviews_notify_partner
after insert on reviews
for each row execute function notify_partner_of_review();


-- ---------------------------------------------------------------------------
-- partner_reviews — the operator's own reviews, with the listing name
-- resolved. Same security_invoker + partner_users filter as partner_bookings.
-- ---------------------------------------------------------------------------

create or replace view partner_reviews as
select
  r.id,
  r.partner_id,
  r.kind,
  r.subject_id,
  subject_title(r.kind, r.subject_id) as listing_title,
  r.rating,
  r.body,
  r.reply,
  r.replied_at,
  r.created_at
from reviews r
where exists (
  select 1 from partner_users pu
  where pu.partner_id = r.partner_id and pu.user_id = auth.uid()
);

alter view partner_reviews set (security_invoker = on);
revoke all on partner_reviews from public;
grant select on partner_reviews to authenticated;


-- ---------------------------------------------------------------------------
-- my_bookings gains the traveller's own rating for each item, so the
-- Bookings screen knows whether to show "Rate this" or "Reviewed". 022's
-- body, one column appended.
-- ---------------------------------------------------------------------------

create or replace view my_bookings as
select
  i.id                                as item_id,
  b.id                                as booking_id,
  b.ref_code,
  b.on_date,
  b.island_slug,
  isl.name                            as island_name,
  i.kind,
  i.subject_id,
  subject_title(i.kind, i.subject_id) as title,
  partner_name(i.partner_id)          as operator,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  partner_maps_url(i.partner_id)      as maps_url,
  partner_address(i.partner_id)       as address,
  partner_photo_path(i.partner_id)    as photo_path,
  i.confirmed_at,
  b.created_at                        as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'partner' and m.read_at is null
  ) as unread_from_partner,
  (select rating from reviews rv where rv.item_id = i.id) as my_rating
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


-- Check: the table answers.
select count(*) as reviews_rows from reviews;
