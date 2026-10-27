-- ===========================================================================
-- Migration 116 — carry whatsapp_number through admin_list_partner_owner_emails
-- so the welcome-email backfill (lib/admin-broadcasts.ts) can also send the
-- WhatsApp welcome template (now live, 5 templates approved by Meta
-- 2026-09-16) to any partner who has a number on file but doesn't yet have
-- a `sent` whatsapp/partner_welcome row in notification_log.
--
-- Also loosens the owner-email filter: a partner is now included if it has
-- EITHER an owner email OR a whatsapp_number, not only email — otherwise a
-- partner with a WhatsApp number but (hypothetically) no resolvable owner
-- auth.users row would be silently skipped for both channels.
--
-- Safe to run more than once.
-- ===========================================================================

drop function if exists admin_list_partner_owner_emails(text);

create function admin_list_partner_owner_emails(p_kind text default null)
returns table (partner_id uuid, partner_name text, owner_email text, whatsapp_number text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, u.email::text, p.whatsapp_number
    from partners p
    left join lateral (
      select pu.user_id
      from partner_users pu
      where pu.partner_id = p.id and pu.role = 'owner'
      order by pu.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    where (u.email is not null or p.whatsapp_number is not null)
      and (p_kind is null or p.kind = p_kind);
end $$;

revoke all on function admin_list_partner_owner_emails(text) from public;
grant execute on function admin_list_partner_owner_emails(text) to authenticated;

select 'welcome whatsapp backfill support installed' as done;
