-- ===========================================================================
-- Migration 005 — proving the service actually happened
--
-- A booking says somebody intends to dive. It does not say they turned up, and
-- it does not say the operator took them out. Redemption is that second fact,
-- and it is worth more than the first one:
--
--   · the traveller gets a ticket that visibly works — it is scanned in front
--     of them and the app says "checked in", which is what trust feels like
--   · the operator gets a record they were the one who delivered it
--   · you get the moment that ends the transaction, which is what you will
--     eventually pay a partner against. No proof of delivery, no payout.
--
-- Two things this design deliberately handles:
--
-- 1. IT WORKS TWICE. Scanning the same ticket again does not error and does not
--    double-count — it answers "already checked in, at 9:04 AM". That matters
--    because a partner standing on a beach with no signal needs an app that
--    queues scans and sends them later, and a queue that cannot safely be
--    replayed is a queue that loses scans.
--
-- 2. ONLY THE RIGHT PARTNER CAN REDEEM IT. A dive shop cannot check in somebody
--    else's ferry passenger, even with a valid code. That is what stops a
--    screenshot of a ticket being worth anything anywhere else.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Who works for whom.
--
-- The partner app needs to know which business the person holding the phone
-- belongs to. Passing a partner id in from the app would mean trusting the
-- app, so the link lives here and is looked up from the signed-in account.
-- ---------------------------------------------------------------------------

create table if not exists partner_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now()
);

create index if not exists partner_users_partner_idx on partner_users (partner_id);

alter table partner_users enable row level security;

drop policy if exists "own partner link" on partner_users;
create policy "own partner link" on partner_users
  for select using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- When it was handed over, and by whom.
-- ---------------------------------------------------------------------------

alter table booking_items add column if not exists redeemed_at timestamptz;
alter table booking_items add column if not exists redeemed_by uuid references partners(id);

create index if not exists booking_items_ticket_idx on booking_items (ticket_code);


-- ---------------------------------------------------------------------------
-- What a code refers to, in words a person can read off a screen.
-- ---------------------------------------------------------------------------

create or replace function subject_title(p_kind text, p_subject_id uuid)
returns text
language sql stable set search_path = public as $$
  select case p_kind
    when 'activity' then (select name from activities where id = p_subject_id)
    when 'ferry'    then (select p.name from sailings s join partners p on p.id = s.partner_id
                          where s.id = p_subject_id)
    when 'table'    then (select name from restaurants where id = p_subject_id)
    when 'event'    then (select name from events where id = p_subject_id)
    when 'trip'     then (select title from trips where id = p_subject_id)
    when 'stay'     then (select name from stays where id = p_subject_id)
    when 'rental'   then (select name from partners where id = p_subject_id)
  end
$$;


-- ---------------------------------------------------------------------------
-- Tidying up what somebody typed or scanned.
--
-- A QR gives a URL; a person at a jetty types five characters into a phone,
-- possibly in lower case, possibly without the AG-. All of those are the
-- same code and all of them should work.
-- ---------------------------------------------------------------------------

create or replace function normalise_code(p_code text)
returns text
language sql immutable as $$
  select upper(
    regexp_replace(
      -- keep only the last path segment if a whole URL was scanned
      regexp_replace(coalesce(p_code, ''), '^.*/', ''),
      '[^A-Za-z0-9-]', '', 'g'
    )
  )
$$;


-- ---------------------------------------------------------------------------
-- look_up_booking — what the partner sees before they commit to anything.
--
-- Read-only. The partner app calls this on scan, shows the traveller's name
-- for the thing and the party size, and the partner taps to confirm. Scanning
-- straight into a redemption is how you check in the wrong person.
-- ---------------------------------------------------------------------------

create or replace function look_up_booking(p_code text)
returns table (
  found        boolean,
  item_id      uuid,
  ref_code     text,
  kind         text,
  title        text,
  party        int,
  starts_at    timestamptz,
  price_paise  int,
  state        text,
  redeemed_at  timestamptz
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
         i.party, i.starts_at, i.price_paise, i.state, i.redeemed_at
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


-- ---------------------------------------------------------------------------
-- redeem_booking — the moment the service is proven delivered.
-- ---------------------------------------------------------------------------

create or replace function redeem_booking(p_code text)
returns table (
  ok          boolean,
  already     boolean,
  message     text,
  ref_code    text,
  kind        text,
  title       text,
  party       int,
  redeemed_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_partner  uuid;
  v_code     text := normalise_code(p_code);
  -- Plain columns rather than a rowtype: plpgsql will not let a record share
  -- an INTO list with other variables, and the ref code lives on the booking.
  v_item_id  uuid;
  v_kind     text;
  v_subject  uuid;
  v_party    int;
  v_when     timestamptz;
  v_ref      text;
  v_title    text;
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();

  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  select i.id, i.kind, i.subject_id, i.party, i.redeemed_at, b.ref_code
    into v_item_id, v_kind, v_subject, v_party, v_when, v_ref
  from booking_items i
  join bookings b on b.id = i.booking_id
  where i.partner_id = v_partner
    and (normalise_code(i.ticket_code) = v_code or normalise_code(b.ref_code) = v_code)
    and i.state <> 'refunded'
  order by (i.redeemed_at is not null), i.starts_at
  limit 1
  for update of i;

  if v_item_id is null then
    return query select false, false,
      'No booking here for that code. Check the reference, or ask them to open the app.'::text,
      null::text, null::text, null::text, null::int, null::timestamptz;
    return;
  end if;

  v_title := subject_title(v_kind, v_subject);

  -- Already done. Not an error — this is the answer a replayed offline scan
  -- and a genuine double-scan both deserve.
  if v_when is not null then
    return query select true, true,
      format('Already checked in at %s.',
             to_char(v_when at time zone 'Asia/Kolkata', 'HH12:MI AM'))::text,
      v_ref, v_kind, v_title, v_party, v_when;
    return;
  end if;

  update booking_items
  set redeemed_at = now(),
      redeemed_by = v_partner,
      state       = 'completed'
  where id = v_item_id
  returning booking_items.redeemed_at into v_when;

  return query select true, false,
    format('Checked in — %s for %s.', v_title, v_party)::text,
    v_ref, v_kind, v_title, v_party, v_when;
end $$;


-- Both are granted to authenticated, which anonymous travellers also hold.
-- That is safe: without a partner_users row they get "not linked to a partner"
-- and can see nothing. The partner link is the gate, not the role.
revoke all on function look_up_booking(text) from public;
revoke all on function redeem_booking(text) from public;
grant execute on function look_up_booking(text) to authenticated;
grant execute on function redeem_booking(text) to authenticated;


-- ---------------------------------------------------------------------------
-- What a partner is owed.
--
-- Not a payout system — just the honest list. Money moves against redeemed
-- items and nothing else, which is the whole reason redemption exists.
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
  i.redeemed_at
from booking_items i
join bookings b on b.id = i.booking_id
where i.redeemed_at is not null;
