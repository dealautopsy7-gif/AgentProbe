-- Screen 10: white-labeled report links, gated to the Agency plan at the
-- application layer (server checks user_plans before inserting a row here).
alter table public.clients add column if not exists brand_color text;

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  created_at timestamptz not null default now()
);

alter table public.client_reports enable row level security;

create policy "client_reports_select_own" on public.client_reports
  for select using (auth.uid() = user_id);
create policy "client_reports_insert_own" on public.client_reports
  for insert with check (auth.uid() = user_id);
create policy "client_reports_delete_own" on public.client_reports
  for delete using (auth.uid() = user_id);

-- Public (anon) read by exact slug — the slug itself is the access control
-- (an unguessable random token), same trust model as runs.public_slug.
create policy "client_reports_select_public" on public.client_reports
  for select using (true);

-- The public report page needs to read the client's own row (name/brand
-- color), its sites, and each site's latest run + fixes — none of which are
-- publicly readable by default (all owner-only above). Each policy below
-- explicitly qualifies every column reference to the correct table alias;
-- migration 0005 fixed a real bug elsewhere caused by an unqualified `id`
-- inside an EXISTS subquery resolving to the wrong table (Postgres column
-- shadowing), so this pattern is deliberately verbose about that.
create policy "clients_select_via_report" on public.clients
  for select using (
    exists (select 1 from public.client_reports cr where cr.client_id = clients.id)
  );

create policy "sites_select_via_client_report" on public.sites
  for select using (
    sites.client_id is not null
    and exists (select 1 from public.client_reports cr where cr.client_id = sites.client_id)
  );

create policy "runs_select_via_client_report" on public.runs
  for select using (
    exists (
      select 1
      from public.sites s
      join public.client_reports cr on cr.client_id = s.client_id
      where s.id = runs.site_id
    )
  );

create policy "fixes_select_via_client_report" on public.fixes
  for select using (
    exists (
      select 1
      from public.runs r
      join public.sites s on s.id = r.site_id
      join public.client_reports cr on cr.client_id = s.client_id
      where r.id = fixes.run_id
    )
  );
