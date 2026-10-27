-- ===========================================================================
-- Migration 110 — target a broadcast at one partner category (ferry, dive,
-- cab, etc.) instead of always every partner.
--
-- broadcast_campaigns (109) gains recipient_kind — null means "every
-- partner" (the only option until now), a value from partners.kind narrows
-- it to just that category. admin_list_partner_owner_emails (106) gains a
-- matching optional filter; existing callers that pass no argument keep
-- getting everyone, since the new parameter defaults to null. Signature
-- changed, so this is drop + recreate, same reasoning 105/107 already used
-- for the same situation.
--
-- Safe to run more than once.
-- ===========================================================================

alter table broadcast_campaigns add column if not exists recipient_kind text;

comment on column broadcast_campaigns.recipient_kind is
  'partners.kind to narrow the send to (e.g. ''ferry''). Null means every partner — the only behaviour before 110.';

drop function if exists admin_list_partner_owner_emails();

create function admin_list_partner_owner_emails(p_kind text default null)
returns table (partner_id uuid, partner_name text, owner_email text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, u.email::text
    from partners p
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = p.id and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    where u.email is not null
      and (p_kind is null or p.kind = p_kind);
end $$;

revoke all on function admin_list_partner_owner_emails(text) from public;
grant execute on function admin_list_partner_owner_emails(text) to authenticated;

select 'broadcast recipient filter installed' as done;
