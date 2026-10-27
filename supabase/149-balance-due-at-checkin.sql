-- ===========================================================================
-- Migration 149 — look_up_booking tells the partner what's still owed
--
-- A deposit-paid booking (any 'choice'-mode category, 138) always had the
-- rest owed to the partner in person — but look_up_booking (005) only ever
-- returned price_paise, the FULL price, with no way to tell a fully-paid
-- booking from one where most of the money is still sitting with the
-- traveller. At the check-in window a partner had no way to know how much
-- to actually collect short of doing the pay_mode/commission math in their
-- head from price_paise alone, every single time.
--
-- Adds pay_mode, paid_online_paise and balance_paise to look_up_booking's
-- return shape — the exact three columns booking_items already carries and
-- create_booking/cancel_my_booking_item already compute, just never handed
-- to this one reader. The return shape is changing, so (same trap 067 hit
-- for cancel_my_booking_item) the old signature has to be dropped first —
-- CREATE OR REPLACE only replaces a function whose return type matches
-- exactly.
--
-- Safe to run more than once.
-- ===========================================================================

drop function if exists look_up_booking(text);

create function look_up_booking(p_code text)
returns table (
  found              boolean,
  item_id            uuid,
  ref_code           text,
  kind               text,
  title              text,
  party              int,
  starts_at          timestamptz,
  price_paise        int,
  state              text,
  redeemed_at        timestamptz,
  pay_mode           text,
  paid_online_paise  int,
  balance_paise      int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_partner uuid;
  v_code    text := normalise_code(p_code);
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  return query
  select true,
         i.id, b.ref_code, i.kind, subject_title(i.kind, i.subject_id),
         i.party, i.starts_at, i.price_paise, i.state, i.redeemed_at,
         i.pay_mode, i.paid_online_paise, i.balance_paise
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.partner_id = v_partner
    and (normalise_code(i.ticket_code) = v_code or normalise_code(b.ref_code) = v_code)
    and i.state <> 'refunded'
  -- Unredeemed first, then earliest: if a shop has two of somebody's bookings
  -- under one reference, check in the one they have not used yet.
  order by (i.redeemed_at is not null), i.starts_at
  limit 1;
end $$;

revoke all on function look_up_booking(text) from public;
grant execute on function look_up_booking(text) to authenticated;

select 'look_up_booking now tells the partner what is still owed' as done;
