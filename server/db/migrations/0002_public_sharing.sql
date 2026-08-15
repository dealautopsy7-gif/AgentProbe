-- Adds opt-in public sharing to runs, needed by:
--   - Landing page (Screen 1): GET /public/samples
--   - Public shareable result (Screen 6): GET /public/runs/:slug
-- A run is only visible through these endpoints once its owner explicitly
-- shares it (POST /runs/:id/share, not yet built) — is_public defaults false.

alter table public.runs
  add column if not exists is_public boolean not null default false,
  add column if not exists public_slug text unique;

create index if not exists idx_runs_public_slug on public.runs(public_slug) where public_slug is not null;

-- Anyone (including anonymous/publishable-key clients) may read a run once
-- its owner has made it public. This is additive to the existing
-- "runs_select_own" policy from 0001_init.sql, not a replacement.
create policy "runs_select_public" on public.runs
  for select using (is_public = true);

-- Attempts/checkpoints/fixes stay owner-only even for public runs — the
-- public read surface is limited to what the API layer explicitly selects
-- (score, checkpoints pass/fail, video, site label), never the fix list or
-- account info, per spec. The API enforces that field-level restriction;
-- these RLS policies just gate row visibility.
create policy "attempts_select_via_public_run" on public.attempts
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.is_public = true)
  );

create policy "checkpoints_select_via_public_run" on public.checkpoints
  for select using (
    exists (
      select 1 from public.attempts a
      join public.runs r on r.id = a.run_id
      where a.id = attempt_id and r.is_public = true
    )
  );
