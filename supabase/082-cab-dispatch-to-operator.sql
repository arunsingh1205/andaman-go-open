-- ===========================================================================
-- Migration 082 — dispatch hands a rate-card booking to a real operator
--
-- 077/078 built dispatch around a standalone in-house driver roster
-- (cab_drivers). That's not how cabs are actually being onboarded: a driver
-- signs up the same way every other cab operator does — register_partner,
-- kind 'cab', then add_partner_car — and gets a real login into the
-- existing partner app. So "assign a driver" should really mean "hand this
-- booking to one of those partners' cars", not a separate contact record.
--
-- cab_drivers and booking_items.driver_id are left in place, unused, rather
-- than dropped — nothing has been assigned through them yet, but dropping
-- live schema on a guess is worse than a harmless orphaned column. This
-- migration adds the real mechanism instead:
--
--   admin_assign_cab_operator(item_id, cab_id) — picks one of the existing
--   marketplace's cars (048), re-checks that car's own availability exactly
--   like create_cab_booking already does, and re-points the booking's
--   partner_id/subject_id from the house "Andaman Go Cabs" partner (077) to
--   the real operator. From that moment the booking is indistinguishable
--   from one that operator took directly — it shows up in their existing
--   partner dashboard, with the traveller's phone number already shown
--   there (app/partner/(dashboard)/bookings/[itemId]) and a notification if
--   they have those on (023).
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function admin_assign_cab_operator(p_item_id uuid, p_cab_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_kind          text;
  v_cab_id        uuid;
  v_state         text;
  v_starts        timestamptz;
  v_booking       uuid;
  v_ticket        text;
  v_ref           text;
  v_new_partner   uuid;
  v_car_listed    boolean;
  v_partner_status text;
  v_trip_type     text;
  v_return_date   date;
  v_days          int;
  v_start_day     date;
  v_end_day       date;
  v_clash         int;
  v_kind_seq      int;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select i.kind, i.cab_id, i.state, i.starts_at, i.booking_id, i.ticket_code
    into v_kind, v_cab_id, v_state, v_starts, v_booking, v_ticket
  from booking_items i where i.id = p_item_id
  for update of i;

  if v_kind is null then
    return query select false, 'That booking no longer exists.'::text;
    return;
  end if;
  if v_kind <> 'cab' or v_cab_id is not null then
    return query select false, 'That is not a rate-card cab booking.'::text;
    return;
  end if;
  if v_state = 'refunded' then
    return query select false, 'This booking was cancelled.'::text;
    return;
  end if;

  select c.partner_id, c.is_listed, p.status
    into v_new_partner, v_car_listed, v_partner_status
  from cabs c
  join partners p on p.id = c.partner_id
  where c.id = p_cab_id;

  if v_new_partner is null then
    return query select false, 'That car no longer exists.'::text;
    return;
  end if;
  if not v_car_listed or v_partner_status <> 'approved' then
    return query select false, 'That car is not currently listed.'::text;
    return;
  end if;

  select d.trip_type, d.return_date, d.days into v_trip_type, v_return_date, v_days
  from cab_trip_details d where d.item_id = p_item_id;

  v_start_day := (v_starts at time zone 'Asia/Kolkata')::date;
  v_end_day := coalesce(v_return_date, v_start_day + greatest(coalesce(v_days, 1) - 1, 0));

  -- Is this car free across [v_start_day .. v_end_day]? Same overlap check
  -- create_cab_booking runs for a marketplace booking (048/073) — one car is
  -- one bookable unit regardless of which flow put it there.
  perform pg_advisory_xact_lock(hashtext('cab:' || p_cab_id::text));

  select count(*) into v_clash
  from booking_items bi
  join cab_trip_details d on d.item_id = bi.id
  where bi.kind = 'cab'
    and bi.cab_id = p_cab_id
    and bi.id <> p_item_id
    and bi.state in ('pending','confirmed','disrupted','completed')
    and (bi.starts_at at time zone 'Asia/Kolkata')::date <= v_end_day
    and coalesce(
          d.return_date,
          (bi.starts_at at time zone 'Asia/Kolkata')::date + greatest(coalesce(d.days, 1) - 1, 0)
        ) >= v_start_day;

  if v_clash > 0 then
    return query select false, 'This car is already booked over those dates — try another.'::text;
    return;
  end if;

  if v_ticket is null then
    select bookings.ref_code into v_ref from bookings where id = v_booking;
    select count(*) into v_kind_seq
    from booking_items
    where booking_id = v_booking and kind = 'cab'
      and created_at < (select created_at from booking_items where id = p_item_id);
    v_ticket := v_ref || '-C' || case when v_kind_seq > 0 then (v_kind_seq + 1)::text else '' end;
  end if;

  update booking_items
  set cab_id = p_cab_id,
      partner_id = v_new_partner,
      subject_id = v_new_partner,
      state = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      ticket_code = v_ticket
  where id = p_item_id;

  if partner_wants_notification(v_new_partner, 'booking_new') then
    insert into partner_notifications (partner_id, kind, title, body, item_id)
    values (
      v_new_partner,
      'booking_new',
      'A cab trip was assigned to you',
      'Andaman Go dispatch · ' ||
        to_char(v_starts at time zone 'Asia/Kolkata', 'FMDy DD Mon · FMHH12:MI AM'),
      p_item_id
    );
  end if;

  return query select true, 'Assigned. The operator can see this booking now.'::text;
end $$;

revoke all on function admin_assign_cab_operator(uuid, uuid) from public;
grant execute on function admin_assign_cab_operator(uuid, uuid) to authenticated;


select 'cab dispatch to operator ready' as done;
