-- Screen 9's model is one monitoring config per site ("per-site (or global
-- default) cadence"), not a list of overlapping schedules. This constraint
-- enables clean upsert semantics for POST/PUT /schedules and
-- PUT /sites/:id/alerts, rather than the API having to guess which of
-- several schedules for the same site to update.
alter table public.schedules
  add constraint schedules_site_id_unique unique (site_id);
