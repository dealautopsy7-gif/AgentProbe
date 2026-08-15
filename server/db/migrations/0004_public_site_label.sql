-- The public share page (Screen 6) needs the site's label/hostname, but
-- 0001's sites RLS only allows the owner to read their own sites. Scope a
-- public-read policy tightly: a site is readable by anyone only if it has
-- at least one run its owner has explicitly made public.
create policy "sites_select_via_public_run" on public.sites
  for select using (
    exists (select 1 from public.runs r where r.site_id = id and r.is_public = true)
  );
