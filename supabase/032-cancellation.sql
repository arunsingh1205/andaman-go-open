-- ===========================================================================
-- Migration 032 — cancellation policy, and a way to actually cancel
--
-- refund_booking (004) has been in the schema since the beginning and nothing
-- has ever called it — there's no "cancel my booking" anywhere in the app.
-- This adds one, governed by a policy the operator picks:
--
--   flexible  — free cancellation up to 24 hours before the start
--   moderate  — up to 72 hours before
--   strict    — up to 7 days before
--
-- Past that cutoff the traveller can't self-cancel — they message the
-- operator through the booking thread (022). There's no money in the app
-- yet, so "free" is about whether the app lets you do it, not a refund
-- amount.
--
-- Safe to run more than once.
-- ===========================================================================


alter table partners add column if not exists cancellation_tier text not null default 'flexible'
  check (cancellation_tier in ('flexible', 'moderate', 'strict'));


-- Definer helper, same reason as partner_name / partner_maps_url (006/014):
-- my_bookings runs security_invoker, so a plain join to partners would hide a
-- suspended operator's policy from a traveller's own booking history.
create or replace function partner_cancellation_tier(p_partner_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(cancellation_tier, 'flexible') from partners where id = p_partner_id
$$;

grant execute on function partner_cancellation_tier(uuid) to authenticated, anon;


-- ---------------------------------------------------------------------------
-- set_partner_cancellation_tier — owner only.
-- ---------------------------------------------------------------------------

create or replace function set_partner_cancellation_tier(p_tier text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
begin
  select pu.partner_id into v_partner
  from partner_users pu
  where pu.user_id = auth.uid() and pu.role = 'owner';

  if v_partner is null then
    return query select false, 'Only the business owner can change this.'::text;
    return;
  end if;

  if p_tier not in ('flexible', 'moderate', 'strict') then
    return query select false, 'Pick a valid policy.'::text;
    return;
  end if;

  update partners set cancellation_tier = p_tier where id = v_partner;

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_partner_cancellation_tier(text) from public;
grant execute on function set_partner_cancellation_tier(text) to authenticated;


-- ---------------------------------------------------------------------------
-- cancel_my_booking_item — the traveller, one item, inside the window.
-- ---------------------------------------------------------------------------

create or replace function cancel_my_booking_item(p_item_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_state   text;
  v_starts  timestamptz;
  v_partner uuid;
  v_kind    text;
  v_subject uuid;
  v_tier    text;
  v_hours   int;
  v_title   text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.state, i.starts_at, i.partner_id, i.kind, i.subject_id
    into v_state, v_starts, v_partner, v_kind, v_subject
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be cancelled here.'::text;
    return;
  end if;

  select coalesce(cancellation_tier, 'flexible') into v_tier from partners where id = v_partner;
  v_hours := case v_tier when 'strict' then 168 when 'moderate' then 72 else 24 end;

  if now() > v_starts - make_interval(hours => v_hours) then
    return query select false, format(
      'Free cancellation closed %s hours before the start. Message the operator to cancel.',
      v_hours
    )::text;
    return;
  end if;

  update booking_items set state = 'refunded' where id = p_item_id;

  -- Tell the operator (respecting their notification preference, 023). No
  -- cancelled_note — that column means "an admin did this" (018/019).
  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'Booking cancelled by the traveller',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, 'Cancelled.'::text;
end $$;

revoke all on function cancel_my_booking_item(uuid) from public;
grant execute on function cancel_my_booking_item(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- my_bookings gains the policy that applies to each item. 024's body, one
-- column appended.
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
  (select rating from reviews rv where rv.item_id = i.id) as my_rating,
  partner_cancellation_tier(i.partner_id) as cancellation_tier
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;


-- Check: every partner has a tier now.
select cancellation_tier, count(*) from partners group by cancellation_tier order by 1;
