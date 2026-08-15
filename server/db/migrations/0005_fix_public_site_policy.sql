-- 0004's sites_select_via_public_run policy had an unqualified `id` inside
-- its EXISTS subquery. Postgres resolved it to the subquery's own
-- runs.id (column shadowing), not the outer sites.id, compiling to
-- "r.site_id = r.id" — always false, since a run's id never equals its own
-- site_id. The policy existed and looked correct but silently matched zero
-- rows. Confirmed via `select policyname, qual from pg_policies where
-- tablename = 'sites'` showing the miscompiled qual, then fixed by
-- explicitly qualifying the outer reference.
drop policy if exists "sites_select_via_public_run" on public.sites;

create policy "sites_select_via_public_run" on public.sites
  for select using (
    exists (select 1 from public.runs r where r.site_id = sites.id and r.is_public = true)
  );
