-- ===========================================================================
-- Migration 033 — the admin console catches up
--
-- Twelve rounds of partner-app work later, an admin can't see most of what
-- those rounds created: the message thread on a booking, the reviews, who's
-- on a partner's team, what dates they've closed. The support inbox (030)
-- made that acute — you can't help a partner about a conversation you can't
-- read.
--
-- All read-only except admin_remove_review, and every one is is_admin()-
-- gated inside (SECURITY DEFINER) or through an "admins see all" policy.
--
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Reviews.
-- ---------------------------------------------------------------------------

drop policy if exists "admins see all reviews" on reviews;
create policy "admins see all reviews" on reviews
  for select using (is_admin());

create or replace view admin_reviews as
select
  r.id,
  r.partner_id,
  p.name                              as partner_name,
  r.kind,
  r.subject_id,
  subject_title(r.kind, r.subject_id) as listing_title,
  r.rating,
  r.body,
  r.reply,
  r.replied_at,
  r.created_at
from reviews r
join partners p on p.id = r.partner_id
where is_admin();

alter view admin_reviews set (security_invoker = on);
revoke all on admin_reviews from public;
grant select on admin_reviews to authenticated;


create or replace function admin_remove_review(p_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  -- The delete fires recompute_listing_rating (031), so the listing's star
  -- rating re-blends without this review straight away.
  delete from reviews where id = p_id;

  if not found then
    return query select false, 'Review not found.'::text;
    return;
  end if;

  return query select true, 'Removed.'::text;
end $$;

revoke all on function admin_remove_review(uuid) from public;
grant execute on function admin_remove_review(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- A partner's team and pending invites — partner_users / partner_invites RLS
-- only ever lets the person themselves or the owner read these, so an admin
-- needs a definer door.
-- ---------------------------------------------------------------------------

create or replace function admin_partner_team(p_partner_id uuid)
returns table (email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.email, pu.role, pu.created_at
  from partner_users pu
  join auth.users u on u.id = pu.user_id
  where pu.partner_id = p_partner_id and is_admin()
  order by (pu.role <> 'owner'), pu.created_at;
$$;

revoke all on function admin_partner_team(uuid) from public;
grant execute on function admin_partner_team(uuid) to authenticated;


create or replace function admin_partner_invites(p_partner_id uuid)
returns table (email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select email, role, created_at
  from partner_invites
  where partner_id = p_partner_id and accepted_at is null and is_admin()
  order by created_at;
$$;

revoke all on function admin_partner_invites(uuid) from public;
grant execute on function admin_partner_invites(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The booking message thread — booking_messages RLS is partner-or-traveller,
-- so an admin reads it through here. Read-only; an admin can't post.
-- ---------------------------------------------------------------------------

create or replace function admin_booking_thread(p_item_id uuid)
returns table (sender text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select sender, body, created_at
  from booking_messages
  where item_id = p_item_id and is_admin()
  order by created_at;
$$;

revoke all on function admin_booking_thread(uuid) from public;
grant execute on function admin_booking_thread(uuid) to authenticated;


-- Check: the review view answers.
select count(*) as admin_reviews_rows from admin_reviews;
