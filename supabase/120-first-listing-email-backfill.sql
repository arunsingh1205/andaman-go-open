-- ===========================================================================
-- Migration 120 — backfill support for the first-listing email (119): finds
-- every partner who already added a listing before 119 shipped, so never
-- triggered the new send, and hasn't been sent the email yet.
--
-- "Already added a listing" is checked against every category a partner can
-- self-add through lib/partner-register.ts's addPartnerX functions —
-- activities, vehicles, stays, events, community_services, trips, sailings.
-- Cabs are deliberately excluded: there's no addPartnerCab (cabs are
-- seed/admin-only, per lib/partner-register.ts's own comment), so a partner
-- with only a cab never went through the flow this email is about.
--
-- Safe to run more than once.
-- ===========================================================================

create or replace function admin_list_partners_needing_first_listing_email()
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
    where p.first_listing_email_sent = false
      and u.email is not null
      and (
        exists (select 1 from activities a where a.partner_id = p.id)
        or exists (select 1 from vehicles v where v.partner_id = p.id)
        or exists (select 1 from stays s where s.partner_id = p.id)
        or exists (select 1 from events e where e.partner_id = p.id)
        or exists (select 1 from community_services cs where cs.partner_id = p.id)
        or exists (select 1 from trips t where t.partner_id = p.id)
        or exists (select 1 from sailings sa where sa.partner_id = p.id)
      );
end $$;

revoke all on function admin_list_partners_needing_first_listing_email() from public;
grant execute on function admin_list_partners_needing_first_listing_email() to authenticated;

select 'first-listing email backfill RPC installed' as done;
