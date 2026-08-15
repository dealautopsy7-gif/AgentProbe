-- AgentProbe core schema. RLS enabled on every table per spec.
-- Auth users come from Supabase auth.users; we don't duplicate that table.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now()
);

alter table public.sites enable row level security;

create policy "sites_select_own" on public.sites
  for select using (auth.uid() = user_id);
create policy "sites_insert_own" on public.sites
  for insert with check (auth.uid() = user_id);
create policy "sites_update_own" on public.sites
  for update using (auth.uid() = user_id);
create policy "sites_delete_own" on public.sites
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------
create type public.run_status as enum ('queued', 'running', 'done', 'failed');

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text not null,
  status public.run_status not null default 'queued',
  score smallint check (score is null or (score >= 0 and score <= 100)),
  completion_rate real check (completion_rate is null or (completion_rate >= 0 and completion_rate <= 1)),
  cost_usd numeric(10, 4),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.runs enable row level security;

create policy "runs_select_own" on public.runs
  for select using (auth.uid() = user_id);
create policy "runs_insert_own" on public.runs
  for insert with check (auth.uid() = user_id);
create policy "runs_update_own" on public.runs
  for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- attempts
-- ---------------------------------------------------------------------------
create type public.attempt_outcome as enum ('success', 'fail', 'blocked');

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  attempt_number smallint not null,
  outcome public.attempt_outcome,
  stuck_reason text,
  video_path text,
  created_at timestamptz not null default now(),
  unique (run_id, attempt_number)
);

alter table public.attempts enable row level security;

create policy "attempts_select_via_run" on public.attempts
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- checkpoints
-- ---------------------------------------------------------------------------
create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  name text not null,
  passed boolean,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.checkpoints enable row level security;

create policy "checkpoints_select_via_run" on public.checkpoints
  for select using (
    exists (
      select 1 from public.attempts a
      join public.runs r on r.id = a.run_id
      where a.id = attempt_id and r.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- run_steps
-- ---------------------------------------------------------------------------
create table if not exists public.run_steps (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  step_number smallint not null,
  action text not null,
  agent_reasoning text,
  screenshot_path text,
  "timestamp" timestamptz not null default now(),
  unique (attempt_id, step_number)
);

alter table public.run_steps enable row level security;

create policy "run_steps_select_via_run" on public.run_steps
  for select using (
    exists (
      select 1 from public.attempts a
      join public.runs r on r.id = a.run_id
      where a.id = attempt_id and r.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- fixes
-- ---------------------------------------------------------------------------
create type public.fix_severity as enum ('critical', 'high', 'medium');

create table if not exists public.fixes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  severity public.fix_severity not null,
  problem text not null,
  likely_cause text,
  suggested_fix text not null,
  created_at timestamptz not null default now()
);

alter table public.fixes enable row level security;

create policy "fixes_select_via_run" on public.fixes
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- schedules
-- ---------------------------------------------------------------------------
create type public.schedule_cadence as enum ('daily', 'weekly');

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cadence public.schedule_cadence not null,
  goals jsonb not null default '[]'::jsonb,
  alert_threshold smallint not null default 10,
  alert_channels jsonb not null default '["email"]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.schedules enable row level security;

create policy "schedules_select_own" on public.schedules
  for select using (auth.uid() = user_id);
create policy "schedules_insert_own" on public.schedules
  for insert with check (auth.uid() = user_id);
create policy "schedules_update_own" on public.schedules
  for update using (auth.uid() = user_id);
create policy "schedules_delete_own" on public.schedules
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  old_score smallint,
  new_score smallint,
  delivered boolean not null default false
);

alter table public.alerts enable row level security;

create policy "alerts_select_own" on public.alerts
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_sites_user on public.sites(user_id);
create index if not exists idx_runs_site on public.runs(site_id);
create index if not exists idx_runs_user on public.runs(user_id);
create index if not exists idx_attempts_run on public.attempts(run_id);
create index if not exists idx_checkpoints_attempt on public.checkpoints(attempt_id);
create index if not exists idx_run_steps_attempt on public.run_steps(attempt_id);
create index if not exists idx_fixes_run on public.fixes(run_id);
create index if not exists idx_schedules_site on public.schedules(site_id);
create index if not exists idx_alerts_site on public.alerts(site_id);

-- NOTE: all inserts/updates from the backend go through the service-role
-- client (src/lib/supabase.ts), which bypasses RLS — these policies exist
-- to protect any future direct-from-browser Supabase access (e.g. realtime
-- subscriptions using the user's own JWT for the live-run screen).
