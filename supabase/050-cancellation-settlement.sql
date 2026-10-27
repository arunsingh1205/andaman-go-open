-- ===========================================================================
-- Migration 050 — cancellations settle too
--
-- 036 wrote the flat refund rule (a deposit is never refunded; a full
-- payment gets half back outside 24 hours) but never wired the money it
-- forfeits into Earnings or Revenue — those two screens only ever counted
-- delivered bookings (redeemed_at is not null), so a cancelled booking's
-- retained money just vanished from both ledgers.
--
-- The rule, matching the partner-facing cancellation policy copy
-- (business-view.tsx CancellationPolicy): Andaman Go's commission on a
-- cancellation is the same flat category rate (025) it always takes,
-- computed on price_paise — not a share of whatever happens to be retained.
-- Whatever's retained beyond that commission is the partner's:
--
--   retained    = paid_online_paise − refunded_paise   (kept, not sent back)
--   commission  = round(price_paise × bps / 10000)      (025's normal formula)
--   partner_net = greatest(0, retained − commission)
--
-- A forfeited 30% deposit retains exactly 30% of price — the same figure as
-- commission at the standard 3000bps rate (025) — so partner_net lands at
-- ₹0: nothing was delivered, so the partner earns nothing beyond the
-- commission Andaman Go always takes. A full payment cancelled outside 24
-- hours retains 50%; 30 points of that is commission, the remaining 20
-- points are the partner's. Kept in the app, not the view, next to
-- commissionOf() — same approach 036 took and never finished.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. cancelled_at — booking_items never had a timestamp for "when this left
--    pending/confirmed", so cancellations can't be bucketed into a month or
--    day the way redeemed_at does for deliveries. Stamped by all three
--    cancel paths below.
-- ---------------------------------------------------------------------------

alter table booking_items add column if not exists cancelled_at timestamptz;


-- ---------------------------------------------------------------------------
-- 2. cancel_my_booking_item — 036's body, plus the timestamp.
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
  v_mode    text;
  v_price   int;
  v_paid    int;
  v_refund  int;
  v_title   text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select i.state, i.starts_at, i.partner_id, i.kind, i.subject_id,
         i.pay_mode, i.price_paise, i.paid_online_paise
    into v_state, v_starts, v_partner, v_kind, v_subject,
         v_mode, v_price, v_paid
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

  return query select true, case
    when v_refund > 0 then 'Cancelled. Half comes back to you.'
    when v_mode = 'deposit' then 'Cancelled. The deposit is not refundable.'
    else 'Cancelled. Inside 24 hours, nothing is refunded.'
  end::text;
end $$;

revoke all on function cancel_my_booking_item(uuid) from public;
grant execute on function cancel_my_booking_item(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. admin_cancel_booking — same, plus the timestamp.
-- ---------------------------------------------------------------------------

create or replace function admin_cancel_booking(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_paid  int;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason before cancelling.'::text;
    return;
  end if;

  select state, paid_online_paise into v_state, v_paid
  from booking_items where id = p_item_id for update;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
    return;
  end if;

  update booking_items
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason),
      cancelled_at = now()
  where id = p_item_id;

  return query select true, 'Cancelled.'::text;
end $$;

revoke all on function admin_cancel_booking(uuid, text) from public;
grant execute on function admin_cancel_booking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. partner_cancel_booking_item — same, plus the timestamp. This is the
--    operator's own cancel: refunded_paise = v_paid (the traveller is always
--    made whole), so retained is always 0 and it never contributes
--    settlement money — it still gets stamped for a consistent audit trail.
-- ---------------------------------------------------------------------------

create or replace function partner_cancel_booking_item(p_item_id uuid, p_reason text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_state    text;
  v_paid     int;
  v_starts   timestamptz;
  v_kind     text;
  v_subject  uuid;
  v_title    text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return query select false, 'Add a reason — the traveller sees this.'::text;
    return;
  end if;

  select i.state, i.paid_online_paise, i.starts_at, i.kind, i.subject_id
    into v_state, v_paid, v_starts, v_kind, v_subject
  from booking_items i
  where i.id = p_item_id and i.partner_id = v_partner
  for update of i;

  if v_state is null then
    return query select false, 'Booking not found.'::text;
    return;
  end if;
  if v_state not in ('pending', 'confirmed') then
    return query select false, 'This booking can no longer be changed.'::text;
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

  return query select true, 'Cancelled and refunded.'::text;
end $$;

revoke all on function partner_cancel_booking_item(uuid, text) from public;
grant execute on function partner_cancel_booking_item(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. admin_bookings — cancelled_at appended, same append-only pattern 036
--    used for its four columns.
-- ---------------------------------------------------------------------------

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
  i.cancelled_at
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


-- ---------------------------------------------------------------------------
-- 6. partner_cancellations — the cancellation-side sibling of
--    partner_delivered (036). Deliberately a separate view rather than
--    folding into partner_delivered: dashboard-view / partner-insights read
--    that view's row count as "deliveries today", and a cancellation is not
--    a delivery. Scoped the same way, filtered to rows that actually
--    retained money — a partner cancellation (retained = 0) never appears
--    here, matching the policy that the traveller is made whole.
-- ---------------------------------------------------------------------------

create or replace view partner_cancellations as
select
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.party,
  i.price_paise,
  i.starts_at,
  i.cancelled_at,
  cr.bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.refunded_paise
from booking_items i
join bookings b on b.id = i.booking_id
left join commission_rates cr on cr.kind = i.kind
where i.state = 'refunded'
  and i.cancelled_at is not null
  and (i.paid_online_paise - i.refunded_paise) > 0
  and exists (
    select 1 from partner_users pu
    where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
  );

alter view partner_cancellations set (security_invoker = on);
grant select on partner_cancellations to authenticated;


-- Check: every function still resolves, both views answer.
select count(*) as cancelled_at_cols
from information_schema.columns
where table_name = 'booking_items' and column_name = 'cancelled_at';
select count(*) as admin_bookings_rows from admin_bookings;
select count(*) as partner_cancellations_rows from partner_cancellations;
