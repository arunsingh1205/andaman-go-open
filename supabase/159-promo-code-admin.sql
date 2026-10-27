-- ===========================================================================
-- Migration 159 — admin CRUD for promo codes
--
-- 158 built the traveller-facing half (validate_promo_code, the redemption
-- inside create_booking) but left no way to actually create a code — not
-- even FIRSTGO existed anywhere. promo_codes/promo_redemptions (158) were
-- deliberately left with no select policy and all grants revoked, same as
-- booking_messages: a code's existence is meant to only ever surface through
-- validate_promo_code, never a direct read. That means the admin screen
-- can't just select the table the way cab_rate_card's admin screen does —
-- it needs its own RPCs, same is_admin()-gated shape as
-- admin_upsert_cab_rate / admin_set_cab_rate_active (078).
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function admin_list_promo_codes()
returns table (
  id uuid, code text, discount_paise int, active boolean,
  created_at timestamptz, redemption_count bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
  select pc.id, pc.code, pc.discount_paise, pc.active, pc.created_at,
         count(pr.id)
  from promo_codes pc
  left join promo_redemptions pr on pr.promo_code_id = pc.id
  group by pc.id
  order by pc.created_at desc;
end $$;

revoke all on function admin_list_promo_codes() from public;
grant execute on function admin_list_promo_codes() to authenticated;


create or replace function admin_upsert_promo_code(
  p_id uuid,
  p_code text,
  p_discount_paise int,
  p_active boolean default true
)
returns table (ok boolean, message text, promo_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_id   uuid;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if v_code = '' then
    return query select false, 'Give this code a value.'::text, null::uuid;
    return;
  end if;
  if p_discount_paise is null or p_discount_paise <= 0 then
    return query select false, 'Enter a discount greater than zero.'::text, null::uuid;
    return;
  end if;

  if p_id is not null then
    update promo_codes set
      code = v_code,
      discount_paise = p_discount_paise,
      active = coalesce(p_active, true)
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return query select false, 'That code no longer exists.'::text, null::uuid;
      return;
    end if;
  else
    insert into promo_codes (code, discount_paise, active)
    values (v_code, p_discount_paise, coalesce(p_active, true))
    returning id into v_id;
  end if;

  return query select true, 'Saved.'::text, v_id;
exception when unique_violation then
  return query select false, ('"' || v_code || '" is already in use.')::text, null::uuid;
end $$;

revoke all on function admin_upsert_promo_code(uuid, text, int, boolean) from public;
grant execute on function admin_upsert_promo_code(uuid, text, int, boolean) to authenticated;


create or replace function admin_set_promo_code_active(p_id uuid, p_active boolean)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_hit boolean;
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update promo_codes set active = coalesce(p_active, false) where id = p_id;
  v_hit := found;

  if not v_hit then
    return query select false, 'That code no longer exists.'::text;
    return;
  end if;

  return query select true, (case when p_active then 'Code reactivated.' else 'Code paused.' end)::text;
end $$;

revoke all on function admin_set_promo_code_active(uuid, boolean) from public;
grant execute on function admin_set_promo_code_active(uuid, boolean) to authenticated;

select 'promo code admin RPCs ready' as done;
