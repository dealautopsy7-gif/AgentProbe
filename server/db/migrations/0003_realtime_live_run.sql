-- Supports Screen 4 (Live Run) streaming via Supabase Realtime instead of
-- client-side polling, per spec: "do not poll on a tight loop — stream."

-- The frontend needs to know how many attempts were requested (to render
-- "ATTEMPT 2/5" and to know when the final attempt has concluded).
alter table public.runs
  add column if not exists attempts_total smallint;

-- The worker now writes/updates a checkpoint row per name as each step
-- lands (upsert), instead of a single batch insert at the end — needs a
-- conflict target.
alter table public.checkpoints
  add constraint checkpoints_attempt_name_unique unique (attempt_id, name);

-- Realtime postgres_changes delivery is already scoped by each table's RLS
-- policies (a user only receives events for rows they could SELECT), so
-- enabling replication here doesn't widen access beyond 0001/0002's policies.
alter publication supabase_realtime add table public.runs;
alter publication supabase_realtime add table public.attempts;
alter publication supabase_realtime add table public.checkpoints;
alter publication supabase_realtime add table public.run_steps;
