-- ===========================================================================
-- Migration 028 — insights: listing views, and the data behind the numbers
--
-- The partner app has always shown a partner what already booked. It has
-- never shown them demand — how many people looked at a listing, how that
-- compares to last month, how often a booking falls through. This is the
-- data layer for an Insights tab.
--
-- Two pieces:
--   listing_views    — one row per time a traveller opens a listing's page.
--                      Written only through record_listing_view(), which
--                      resolves the listing itself so a client can't forge
--                      a partner_id or inflate someone else's count.
--   partner_bookings — gains subject_id, so bookings and views can be lined
--                      up per listing (append-only, per CREATE OR REPLACE
--                      VIEW's rule).
--
-- Everything else the Insights tab shows (cancellation rate, no-show rate,
-- lead time, month-over-month) is derived in the app from data that already
-- exists — no new columns for it.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The views.
-- ---------------------------------------------------------------------------

create table if not exists listing_views (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in
                ('activity', 'table', 'event', 'trip', 'stay', 'rental')),
  subject_id  uuid not null,
  partner_id  uuid not null references partners(id) on delete cascade,
  viewed_at   timestamptz not null default now()
);

create index if not exists listing_views_partner_idx
  on listing_views (partner_id, subject_id, viewed_at);

alter table listing_views enable row level security;

drop policy if exists "partner reads own listing views" on listing_views;
create policy "partner reads own listing views" on listing_views
  for select using (
    exists (
      select 1 from partner_users pu
      where pu.partner_id = listing_views.partner_id and pu.user_id = auth.uid()
    )
  );

grant select on listing_views to authenticated;


-- ---------------------------------------------------------------------------
-- record_listing_view — resolves the slug to a listing (and its partner)
-- itself, then logs one view. Same seven-branch, never-trust-the-client
-- shape as create_booking. Silently does nothing for an unknown slug so a
-- stale link never surfaces an error to a traveller.
-- ---------------------------------------------------------------------------

create or replace function record_listing_view(p_kind text, p_subject text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid;
  v_partner uuid;
begin
  case p_kind
    when 'activity' then
      select id, partner_id into v_subject, v_partner from activities where slug = p_subject;
    when 'table' then
      select id, partner_id into v_subject, v_partner from restaurants where slug = p_subject;
    when 'event' then
      select id, partner_id into v_subject, v_partner from events where slug = p_subject;
    when 'trip' then
      select id, partner_id into v_subject, v_partner from trips where slug = p_subject;
    when 'stay' then
      select id, partner_id into v_subject, v_partner from stays where slug = p_subject;
    when 'rental' then
      -- the shop IS the subject for a rental, same as create_booking
      select id, id into v_subject, v_partner from partners where slug = p_subject;
    else
      return;
  end case;

  if v_subject is null then
    return;
  end if;

  insert into listing_views (kind, subject_id, partner_id)
  values (p_kind, v_subject, v_partner);
end $$;

revoke all on function record_listing_view(text, text) from public;
grant execute on function record_listing_view(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- partner_view_counts — views per listing for the signed-in partner, all
-- time and over the last 30 days. security_invoker + the partner_users
-- filter, same as partner_bookings.
-- ---------------------------------------------------------------------------

create or replace view partner_view_counts as
select
  lv.partner_id,
  lv.kind,
  lv.subject_id,
  subject_title(lv.kind, lv.subject_id)                               as listing_title,
  count(*)                                                             as views_all,
  count(*) filter (where lv.viewed_at > now() - interval '30 days')    as views_30d
from listing_views lv
where exists (
  select 1 from partner_users pu
  where pu.partner_id = lv.partner_id and pu.user_id = auth.uid()
)
group by lv.partner_id, lv.kind, lv.subject_id, subject_title(lv.kind, lv.subject_id);

alter view partner_view_counts set (security_invoker = on);
revoke all on partner_view_counts from public;
grant select on partner_view_counts to authenticated;


-- ---------------------------------------------------------------------------
-- partner_bookings gains subject_id. 022's body (024 didn't touch it),
-- one column appended.
-- ---------------------------------------------------------------------------

create or replace view partner_bookings as
select
  i.id as item_id,
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  b.contact_phone,
  b.contact_email,
  i.cancelled_note,
  i.confirmed_at,
  b.created_at as booked_at,
  (
    select count(*) from booking_messages m
    where m.item_id = i.id and m.sender = 'traveller' and m.read_at is null
  ) as unread_from_traveller,
  i.subject_id
from booking_items i
join bookings b on b.id = i.booking_id
where exists (
  select 1 from partner_users pu
  where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
);

alter view partner_bookings set (security_invoker = on);
revoke all on partner_bookings from public;
grant select on partner_bookings to authenticated;


-- Check: the views table answers.
select count(*) as listing_views_rows from listing_views;
