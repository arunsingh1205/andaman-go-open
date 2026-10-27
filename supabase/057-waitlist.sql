-- Coming-soon waitlist capture (Phase 2 of the launch plan). Applied
-- directly to production via the Supabase MCP tool on 4 Sep 2026; kept here
-- for the record like every other migration in this folder.

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_key on waitlist (lower(email));

alter table waitlist enable row level security;

drop policy if exists "waitlist_insert_public" on waitlist;
create policy "waitlist_insert_public"
  on waitlist for insert
  to anon, authenticated
  with check (
    email is not null
    and length(email) between 3 and 254
    and email like '%@%'
  );

-- No select/update/delete policy for anon/authenticated: rows are readable
-- only via the Supabase dashboard (service role), by design — this is
-- personal data, not catalogue content.
