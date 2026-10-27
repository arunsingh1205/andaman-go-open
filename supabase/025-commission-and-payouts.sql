-- ===========================================================================
-- Migration 025 — commission rates, and where a payout would go
--
-- Up to now every "money" screen (partner Earnings, admin Revenue) has shown
-- one honest number — gross, i.e. what travellers were charged, counted once
-- the partner checks them in — and deliberately no commission column, because
-- there was no commission.
--
-- Now there is a rate. Not a payment system — still no deposits, no
-- settlement — but a POLICY: what Andaman Go's cut is, per category. It has
-- to be per category because the categories aren't alike. A restaurant table
-- is booked for free (price_paise = 0), so its rate is 0; everything else
-- starts at 30% and Arun tunes it from the console.
--
-- Two tables:
--   commission_rates — one row per booking kind, admin-editable.
--   payout_accounts  — the bank / UPI details a partner enters, so they're
--                      on file for when payouts actually run. Nothing pays
--                      against them yet.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The rate card.
-- ---------------------------------------------------------------------------

create table if not exists commission_rates (
  kind       text primary key check (kind in
               ('activity', 'ferry', 'table', 'event', 'stay', 'trip', 'rental')),
  bps        int not null check (bps between 0 and 10000),   -- basis points: 3000 = 30%
  updated_at timestamptz not null default now()
);

insert into commission_rates (kind, bps) values
  ('activity', 3000),
  ('ferry',    3000),
  ('table',    0),
  ('event',    3000),
  ('stay',     3000),
  ('trip',     3000),
  ('rental',   3000)
on conflict (kind) do nothing;

alter table commission_rates enable row level security;

-- Not secret — a partner needs to see the rate that applies to them, and the
-- delivered/earnings views join it. Writes go through the admin RPC below.
drop policy if exists "commission rates are readable" on commission_rates;
create policy "commission rates are readable" on commission_rates
  for select using (true);

grant select on commission_rates to authenticated;


create or replace function set_commission_rate(p_kind text, p_bps int)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if p_kind not in ('activity', 'ferry', 'table', 'event', 'stay', 'trip', 'rental') then
    return query select false, 'Unknown category.'::text;
    return;
  end if;

  if p_bps is null or p_bps < 0 or p_bps > 10000 then
    return query select false, 'Commission has to be between 0% and 100%.'::text;
    return;
  end if;

  insert into commission_rates (kind, bps, updated_at)
  values (p_kind, p_bps, now())
  on conflict (kind) do update set bps = excluded.bps, updated_at = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_commission_rate(text, int) from public;
grant execute on function set_commission_rate(text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- Where a payout would land.
-- ---------------------------------------------------------------------------

create table if not exists payout_accounts (
  partner_id     uuid primary key references partners(id) on delete cascade,
  account_name   text,
  account_number text,
  ifsc           text,
  upi_id         text,
  updated_at     timestamptz not null default now()
);

alter table payout_accounts enable row level security;

-- The partner sees their own; an admin can see any (they're the ones who
-- would run a payout against it). No write policy — the RPC does that.
drop policy if exists "own or admin payout account" on payout_accounts;
create policy "own or admin payout account" on payout_accounts
  for select using (
    is_admin()
    or exists (
      select 1 from partner_users pu
      where pu.partner_id = payout_accounts.partner_id and pu.user_id = auth.uid()
    )
  );

grant select on payout_accounts to authenticated;


create or replace function set_payout_account(
  p_account_name text,
  p_account_number text,
  p_ifsc text,
  p_upi_id text
) returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_partner uuid;
  v_ifsc    text := nullif(upper(trim(coalesce(p_ifsc, ''))), '');
  v_upi     text := nullif(lower(trim(coalesce(p_upi_id, ''))), '');
  v_acct    text := nullif(regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g'), '');
begin
  select pu.partner_id into v_partner from partner_users pu where pu.user_id = auth.uid();
  if v_partner is null then
    raise exception 'this account is not linked to a partner' using errcode = '42501';
  end if;

  if v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    return query select false, 'That IFSC code doesn''t look right.'::text;
    return;
  end if;
  if v_upi is not null and v_upi !~ '^[a-z0-9._-]+@[a-z0-9.-]+$' then
    return query select false, 'That UPI ID doesn''t look right.'::text;
    return;
  end if;

  insert into payout_accounts (partner_id, account_name, account_number, ifsc, upi_id, updated_at)
  values (v_partner, nullif(trim(p_account_name), ''), v_acct, v_ifsc, v_upi, now())
  on conflict (partner_id) do update set
    account_name   = excluded.account_name,
    account_number = excluded.account_number,
    ifsc           = excluded.ifsc,
    upi_id         = excluded.upi_id,
    updated_at     = now();

  return query select true, 'Saved.'::text;
end $$;

revoke all on function set_payout_account(text, text, text, text) from public;
grant execute on function set_payout_account(text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The two delivered-work views gain the rate that applied. Left join, so a
-- kind with no rate row reads as null and the app treats it as 0. CREATE OR
-- REPLACE VIEW appends columns only — commission_bps goes on the end of each.
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
  cr.bps as commission_bps
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
  cr.bps          as commission_bps
from booking_items i
join bookings b on b.id = i.booking_id
join partners p on p.id = i.partner_id
left join commission_rates cr on cr.kind = i.kind
where is_admin();

alter view admin_bookings set (security_invoker = on);
revoke all on admin_bookings from public;
grant select on admin_bookings to authenticated;


-- Check: seven rates, table at zero.
select kind, bps from commission_rates order by kind;
