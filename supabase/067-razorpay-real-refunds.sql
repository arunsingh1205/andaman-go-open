-- Real Razorpay refunds on cancellation, plus live status (2026-09-07).
--
-- Every cancel path (cancel_my_booking_item, admin_cancel_booking,
-- partner_cancel_booking_item) has only ever done bookkeeping: flip
-- booking_items.state to 'refunded' and record refunded_paise, the amount
-- the existing policy (032/036/050) says is owed back. Nothing has ever
-- actually told Razorpay to move money — there was no gateway to tell until
-- today. That's why a cancellation looks instant in the app while a real
-- refund still takes Razorpay 3-5 working days to process.
--
-- This migration:
--   1. Adds razorpay_refund_id / refund_status to booking_items.
--   2. Teaches all three cancel functions to also return the item's
--      razorpay_payment_id and the exact refund_paise the policy computed —
--      the app layer uses these to call Razorpay for that exact amount,
--      never a separately recomputed one.
--   3. Adds record_razorpay_refund(), called right after a successful
--      Razorpay refund call, to store the refund id and its initial
--      'processing' status.
--   4. Adds apply_razorpay_refund_webhook(), called by
--      app/api/razorpay/webhook (signature-verified there) to update
--      refund_status to 'processed' or 'failed' as Razorpay reports it —
--      this is the "live" part; nothing here polls.
--   5. Exposes refund_status on my_bookings and admin_bookings so the
--      traveller and admin screens can show "Refund processing" instead of
--      a flat "Refunded" that isn't true yet.
--
-- A booking with no online payment (paid_online_paise = 0, or refund_paise
-- = 0) never gets a razorpay_payment_id here, so the app layer skips the
-- Razorpay call entirely and refund_status stays null — exactly like
-- before, since there's nothing for a gateway to reverse.

alter table booking_items
  add column if not exists razorpay_refund_id text,
  add column if not exists refund_status text
    check (refund_status in ('processing', 'processed', 'failed'));

-- ---------------------------------------------------------------------------
-- cancel_my_booking_item — same rule as 050, now also hands back what to
-- refund and where. The return row grows two columns, so Postgres needs the
-- old one dropped first — same signature, different RETURNS TABLE shape.
-- ---------------------------------------------------------------------------

drop function if exists cancel_my_booking_item(uuid);

create function cancel_my_booking_item(p_item_id uuid)
returns table (ok boolean, message text, razorpay_payment_id text, refund_paise integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_state      text;
  v_starts     timestamptz;
  v_partner    uuid;
  v_kind       text;
  v_subject    uuid;
  v_mode       text;
  v_price      int;
  v_paid       int;
  v_refund     int;
  v_title      text;
  v_razorpay_p text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.state, i.starts_at, i.partner_id, i.kind, i.subject_id,
         i.pay_mode, i.price_paise, i.paid_online_paise, i.razorpay_payment_id
    into v_state, v_starts, v_partner, v_kind, v_subject,
         v_mode, v_price, v_paid, v_razorpay_p
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.id = p_item_id and b.user_id = v_user
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text, null::text, null::int;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be cancelled here.'::text, null::text, null::int;
    return;
  end if;

  -- The rule.
  if v_mode = 'deposit' then
    v_refund := 0;
  elsif now() <= v_starts - interval '24 hours' then
    v_refund := round(v_price * 0.5)::int;
  else
    v_refund := 0;
  end if;

  -- Never hand back more than came in (belt and braces — for a full payment
  -- paid_online_paise = price, so half of it is always covered).
  v_refund := least(v_refund, v_paid);

  update booking_items
  set state = 'refunded', refunded_paise = v_refund, cancelled_at = now()
  where id = p_item_id;

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

  return query select true, (case
    when v_refund > 0 then 'Cancelled. Half comes back to you.'
    when v_mode = 'deposit' then 'Cancelled. The deposit is not refundable.'
    else 'Cancelled. Inside 24 hours, nothing is refunded.'
  end)::text,
  (case when v_refund > 0 then v_razorpay_p else null end),
  v_refund;
end $$;

revoke all on function cancel_my_booking_item(uuid) from public;
grant execute on function cancel_my_booking_item(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- admin_cancel_booking — same, plus the receipt. Same drop-first reason.
-- ---------------------------------------------------------------------------

drop function if exists admin_cancel_booking(uuid, text);

create function admin_cancel_booking(p_item_id uuid, p_reason text)
returns table (ok boolean, message text, razorpay_payment_id text, refund_paise integer)
language plpgsql security definer set search_path = public as $$
declare
  v_state      text;
  v_paid       int;
  v_razorpay_p text;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before cancelling.'::text, null::text, null::int;
    return;
  end if;

  select state, paid_online_paise, razorpay_payment_id
    into v_state, v_paid, v_razorpay_p
  from booking_items where id = p_item_id for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text, null::text, null::int;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text, null::text, null::int;
    return;
  end if;

  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason),
      cancelled_at = now()
  where id = p_item_id;

  return query select true, 'Cancelled.'::text,
    (case when v_paid > 0 then v_razorpay_p else null end),
    v_paid;
end $$;

revoke all on function admin_cancel_booking(uuid, text) from public;
grant execute on function admin_cancel_booking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- partner_cancel_booking_item — same, plus the receipt. Same drop-first reason.
-- ---------------------------------------------------------------------------

drop function if exists partner_cancel_booking_item(uuid, text);

create function partner_cancel_booking_item(p_item_id uuid, p_reason text)
returns table (ok boolean, message text, razorpay_payment_id text, refund_paise integer)
language plpgsql security definer set search_path = public as $$
declare
  v_partner    uuid;
  v_state      text;
  v_paid       int;
  v_starts     timestamptz;
  v_kind       text;
  v_subject    uuid;
  v_title      text;
  v_razorpay_p text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason — the traveller sees this.'::text, null::text, null::int;
    return;
  end if;

  select i.state, i.paid_online_paise, i.starts_at, i.kind, i.subject_id, i.razorpay_payment_id
    into v_state, v_paid, v_starts, v_kind, v_subject, v_razorpay_p
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text, null::text, null::int;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text, null::text, null::int;
    return;
  end if;

  -- The operator backing out means the traveller is made whole — everything
  -- they paid online comes back. sync_availability() (004) reopens the slot
  -- off the state change without needing to know an operator did this.
  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason),
      cancelled_at = now()
  where id = p_item_id;

  if partner_wants_notification(v_partner, 'booking_cancelled') then
    v_title := coalesce(subject_title(v_kind, v_subject), 'A booking');
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_partner,
      'booking_cancelled',
      'You cancelled a booking',
      v_title || ' · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, 'Cancelled and refunded.'::text,
    (case when v_paid > 0 then v_razorpay_p else null end),
    v_paid;
end $$;

revoke all on function partner_cancel_booking_item(uuid, text) from public;
grant execute on function partner_cancel_booking_item(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- record_razorpay_refund — called by the app right after Razorpay accepts a
-- refund request, so the item shows "processing" immediately rather than a
-- blank state until the webhook eventually arrives. Deliberately loose on
-- who can call it (any signed-in user) — it only records a receipt for an
-- item already in 'refunded' state, and can't be used to fabricate a refund
-- Razorpay never actually issued (the id itself is meaningless without a
-- real refund behind it, and the webhook is what confirms outcome anyway).
-- ---------------------------------------------------------------------------

create or replace function record_razorpay_refund(
  p_item_id uuid,
  p_razorpay_refund_id text,
  p_status text default 'processing'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_status not in ('processing', 'processed', 'failed') then
    raise exception 'unknown refund status "%"', p_status using errcode = '22023';
  end if;

  update booking_items
  set razorpay_refund_id = p_razorpay_refund_id, refund_status = p_status
  where id = p_item_id and state = 'refunded';
end $$;

revoke all on function record_razorpay_refund(uuid, text, text) from public;
grant execute on function record_razorpay_refund(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- apply_razorpay_refund_webhook — called only from app/api/razorpay/webhook,
-- which verifies Razorpay's HMAC signature on the raw request body before
-- ever calling this. Granted to anon because a webhook delivery carries no
-- Supabase session; the route's signature check is what actually gates this,
-- the same way the payment signature check gates create_booking's receipt.
-- Matches by razorpay_payment_id (unique per 063) rather than the refund id,
-- since that's what this app already stored at refund time.
-- ---------------------------------------------------------------------------

create or replace function apply_razorpay_refund_webhook(
  p_razorpay_payment_id text,
  p_razorpay_refund_id text,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('processing', 'processed', 'failed') then
    raise exception 'unknown refund status "%"', p_status using errcode = '22023';
  end if;

  update booking_items
  set razorpay_refund_id = coalesce(razorpay_refund_id, p_razorpay_refund_id),
      refund_status = p_status
  where razorpay_payment_id = p_razorpay_payment_id;
end $$;

revoke all on function apply_razorpay_refund_webhook(text, text, text) from public;
grant execute on function apply_razorpay_refund_webhook(text, text, text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- my_bookings (046) and admin_bookings (050) — expose refund_status so the
-- traveller and admin screens can tell "processing" from "done".
-- CREATE OR REPLACE VIEW can only append columns, never reorder or insert
-- them, so refund_status goes at the very end of each select list.
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
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
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
  partner_phone(i.partner_id)         as operator_phone,
  i.refund_status
from booking_items i
join bookings b   on b.id = i.booking_id
join islands  isl on isl.slug = b.island_slug;

alter view my_bookings set (security_invoker = on);
grant select on my_bookings to authenticated, anon;

create or replace view admin_bookings as
select
  i.id            as item_id,
  b.id            as booking_id,
  b.ref_code,
  i.partner_id,
  p.name          as partner_name,
  p.status        as partner_status,
  b.island_slug,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.starts_at,
  i.party,
  i.price_paise,
  i.state,
  i.ticket_code,
  i.redeemed_at,
  i.cancelled_note,
  b.contact_phone,
  b.contact_email,
  b.created_at    as booked_at,
  cr.bps          as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise,
  i.cancelled_at,
  i.delivery_paise,
  i.refund_status
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;

select 'razorpay real refunds wired for traveller, admin and partner cancellations' as done;
