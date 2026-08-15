-- Real "Stop run" support: a distinct terminal status (not reused 'failed',
-- since a cancelled run isn't a failure) plus the BullMQ job id so a still
-- QUEUED job can be removed outright. An already-RUNNING job can't be
-- forcibly killed mid-step from outside — the worker cooperatively checks
-- runs.status between steps/attempts instead (see runWorker.ts).
alter type public.run_status add value if not exists 'cancelled';

alter table public.runs
  add column if not exists bullmq_job_id text;
