-- 0010's runs_select_via_client_report and fixes_select_via_client_report
-- policies queried `sites` directly inside their USING clause. Evaluating
-- that subquery re-applies sites' own RLS policies — including the
-- pre-existing sites_select_via_public_run (migration 0005), whose subquery
-- queries `runs` — which re-applies runs' policies, including
-- runs_select_via_client_report again. sites -> runs -> sites -> runs ...
-- Postgres detects this as infinite recursion and errors on any direct
-- `select * from sites` once RLS actually needs to evaluate it (confirmed
-- via a real anon-client query: "infinite recursion detected in policy for
-- relation sites").
--
-- Fix: route the sites lookup through a SECURITY DEFINER function. Owned by
-- the migration role (which owns the tables), it bypasses RLS internally by
-- default (no FORCE ROW LEVEL SECURITY is set anywhere in this schema), so
-- checking "is this site under a publicly-reportable client" no longer
-- re-triggers sites' own policy set — breaking the cycle.
create or replace function public.site_is_publicly_reportable(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    join public.client_reports cr on cr.client_id = s.client_id
    where s.id = p_site_id
  );
$$;

revoke all on function public.site_is_publicly_reportable(uuid) from public;
grant execute on function public.site_is_publicly_reportable(uuid) to anon, authenticated;

drop policy if exists "runs_select_via_client_report" on public.runs;
create policy "runs_select_via_client_report" on public.runs
  for select using (public.site_is_publicly_reportable(runs.site_id));

drop policy if exists "fixes_select_via_client_report" on public.fixes;
create policy "fixes_select_via_client_report" on public.fixes
  for select using (
    exists (
      select 1 from public.runs r
      where r.id = fixes.run_id
      and public.site_is_publicly_reportable(r.site_id)
    )
  );
