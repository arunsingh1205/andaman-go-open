-- ===========================================================================
-- Migration 036 — one refund rule, and the money on the settlement screens
--
-- 032 gave travellers a "cancel my booking" button governed by a per-partner
-- tier (flexible / moderate / strict) that only ever decided whether the APP
-- let you cancel — there was no money in the system, so nothing to refund.
--
-- 034 changed that: a booking now carries paid_online_paise. So the tiers
-- retire and one flat rule takes over, the same for every partner:
--
--   * a DEPOSIT is never refunded. The traveller chose to pay 30% and hold
--     the rest for the counter; backing out forfeits the 30%.
--   * a FULL payment gets HALF back if cancelled more than 24 hours before
--     the start, and nothing inside 24 hours.
--   * when the OPERATOR cancels (partner_cancel_booking_item, 034; or
--     admin_cancel_booking, 018) the traveller is made whole — the full
--     online amount comes back.
--
-- The settlement maths (what the platform keeps, what it still owes the
-- partner) is derived in the app from the columns these views now expose —
-- same approach the Earnings and Revenue screens already take with
-- commission. No money actually moves yet.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The cancellation tiers go away (deferred here from 034 so the old
--    cancel_my_booking_item, which reads the column, kept working until its
--    replacement below was in place).
-- ---------------------------------------------------------------------------

drop function if exists set_partner_cancellation_tier(text);
drop function if exists partner_cancellation_tier(uuid);
alter table partners drop column if exists cancellation_tier;


-- ---------------------------------------------------------------------------
-- 2. cancel_my_booking_item — the traveller, one item, the flat rule.
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
  set state = 'refunded', refunded_paise = v_refund
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
-- 3. admin_cancel_booking — 018's body, one line added: the operator side
--    means a full refund, so refunded_paise follows paid_online_paise.
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
  set state = 'refunded', refunded_paise = v_paid, cancelled_note = trim(p_reason)
  where id = p_item_id;

  return query select true, 'Cancelled.'::text;
end $$;

revoke all on function admin_cancel_booking(uuid, text) from public;
grant execute on function admin_cancel_booking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. The settlement columns land on the two "money" views.
--
-- Both are CREATE OR REPLACE — the four columns append after 025's
-- commission_bps, nothing reorders. The app already turns commission_bps +
-- price_paise into a commission figure; it now also has:
--
--   retained = case
--                when redeemed        then price
--                when refunded        then price - refunded_paise
--                else 0
--   commission        = round(retained * bps / 10000)
--   partner_total_due = retained - commission
--   cash_collected    = (redeemed and pay_mode='deposit') ? price - paid_online : 0
--   platform_owes     = partner_total_due - cash_collected
--
-- Kept in the app, not the view, so the one place the formula lives is next
-- to the screens that show it.
-- ---------------------------------------------------------------------------

create or replace view partner_delivered as
select
  i.partner_id,
  b.ref_code,
  i.kind,
  subject_title(i.kind, i.subject_id) as title,
  i.party,
  i.price_paise,
  i.starts_at,
  i.redeemed_at,
  cr.bps as commission_bps,
  i.pay_mode,
  i.paid_online_paise,
  i.balance_paise,
  i.refunded_paise
from booking_items i
join bookings b on b.id = i.booking_id
left join commission_rates cr on cr.kind = i.kind
where i.redeemed_at is not null
  and exists (
    select 1 from partner_users pu
    where pu.partner_id = i.partner_id and pu.user_id = auth.uid()
  );

alter view partner_delivered set (security_invoker = on);
grant select on partner_delivered to authenticated;


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
  i.refunded_paise
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


-- ---------------------------------------------------------------------------
-- Trips that never fill: out of scope here. trips.min_seats / seats_total
-- already exist and the trip screen already says "N more people needed". If a
-- run doesn't reach its minimum the operator cancels it with
-- partner_cancel_booking_item, which full-refunds every seat. A scheduled job
-- that does it automatically is a later slice.
-- ---------------------------------------------------------------------------


-- Check: no partner still carries a tier, and the views answer.
select count(*) as tier_cols
from information_schema.columns
where table_name = 'partners' and column_name = 'cancellation_tier';
select count(*) as admin_bookings_rows from admin_bookings;
