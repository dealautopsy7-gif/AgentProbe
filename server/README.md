# AgentProbe server

Backend for AgentProbe: API + BullMQ worker that runs an autonomous agent
against a site and scores it. See the product spec in project memory
(`agentprobe-product-spec`) for the full picture — this README covers only
what's needed to run what's here.

## Status

The API, auth, queue, worker, and DB plumbing are all real and verified
end-to-end (see "Verifying the pipeline" below) — but the actual agent is
not. Two pieces that would cost money and require external accounts are
still stubs that throw "not implemented":

- `src/agent/drivers/GeminiComputerUseDriver.ts` — needs the Gemini API wired up.
- `src/agent/providers/SteelBrowserProvider.ts` / `BrowserbaseBrowserProvider.ts` — need a hosted browser vendor wired up.

Each stub has a TODO comment with the specific next step. Until those are
wired up, `AGENT_MODE=stub` (the default) makes the worker fake attempt
outcomes instead of calling them — see `src/agent/stubRunAgentAttempt.ts`.
Real auth is live: every protected route (`/runs`, `/sites`, `/schedules`)
requires a real Supabase session JWT (`src/middleware/auth.ts`) — nothing
trusts a client-supplied `userId` anymore.

## Setup

```bash
cd server
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at minimum to run the API
docker compose up -d   # local Redis, for BullMQ
```

Apply every file in `db/migrations/` to your Supabase project, in order
(SQL editor, `supabase db push`, or — now that `DATABASE_URL` is in
`.env` — directly: `psql "$DATABASE_URL" -f db/migrations/000N_*.sql`).
0003 enables Realtime replication on `runs`/`attempts`/`checkpoints`/`run_steps`
(without it Live Run has nothing to subscribe to); 0004+0005 add and then
fix the `sites` public-read policy Screen 6 needs.

```bash
npm run typecheck   # should pass with no external services running
npm run dev          # starts the Express API on :8787
npm run worker       # starts the BullMQ worker (separate process)
```

## Verifying the pipeline

With the API and worker both running (and `AGENT_MODE=stub`, the default):

```bash
npx tsx scripts/verify-pipeline.ts
```

Creates a throwaway confirmed test user via the Supabase Admin API (no real
inbox needed), calls the real `POST /runs` as that user, polls
`GET /runs/:id` until the stub worker marks it done, prints the resulting
attempts/checkpoints, and deletes the test user afterward (cascade deletes
clean up its sites/runs/attempts/checkpoints automatically — nothing else
to tidy up).

## The Day-1 gate

**Do this before writing any more agent code** (per the spec — the whole
business model depends on this number). Requires:

- `GEMINI_API_KEY` + a pinned `GEMINI_COMPUTER_USE_MODEL`
- Steel.dev running (via `docker compose up`, once the commented service in
  `docker-compose.yml` is filled in with a confirmed image) or Browserbase
  credentials
- The TODOs in `GeminiComputerUseDriver.ts`, `SteelBrowserProvider.ts`, and
  `runAgentAttempt.ts` (screenshot capture + action execution) actually wired up

```bash
npm run gate
```

It runs one full attempt, prints token usage + browser-minutes + total
cost, and exits non-zero if cost exceeds the ~$0.20–0.40 ceiling from the
spec. **Fill in the per-token and per-browser-minute pricing constants at
the top of `scripts/day1-gate.ts`** once you know which model/vendor
you're actually billing against — they're 0 by default and the script
warns loudly if you run it that way.

## Layout

```
src/
  config/env.ts          zod-validated env, lazy so import never throws at compile time
  middleware/auth.ts      verifies the Supabase session JWT, attaches req.userId
  lib/                    supabase client, redis connection, BullMQ queue
  agent/
    AgentDriver.ts        reasoning-model interface (Gemini computer-use is the only impl)
    BrowserProvider.ts    hosted-browser interface (Steel primary, Browserbase fallback)
    drivers/ providers/   the "live" stub implementations described above
    stubRunAgentAttempt.ts  the AGENT_MODE=stub fake-but-realistic attempt generator
    checkpoints.ts        the ecommerce rubric + evaluation
    scoring.ts            weighted 0-100 score from checkpoint results across attempts
    runAgentAttempt.ts    the real observe/decide/act loop + the checkout hard-stop
    videoPipeline.ts      ffmpeg trim-to-failure + caption burn-in
  routes/                 Express routers: POST /runs (auth'd, finds-or-creates the site),
                           GET /runs/:id, POST /runs/:id/share, GET /runs/:id/video,
                           /sites (dashboard join, site detail, PUT :id/alerts),
                           /schedules (full CRUD), /public/samples + /public/runs/:slug (no auth)
  views/publicRunPage.ts  server-rendered HTML (OG tags included) for the public share page
  workers/runWorker.ts    BullMQ worker: runs N attempts (stub or live per AGENT_MODE), aggregates, writes to Supabase
db/migrations/
  0001_init.sql                  full schema, RLS on every table
  0002_public_sharing.sql        is_public/public_slug on runs + public-read RLS, for Screens 1 and 6
  0003_realtime_live_run.sql     attempts_total, checkpoints upsert constraint, Realtime publication for Screen 4
  0004_public_site_label.sql     public-read policy for sites (had a bug — see 0005)
  0005_fix_public_site_policy.sql  fixes 0004's column-shadowing bug (see "Screen 6" section below)
  0006_schedules_unique_site.sql   one schedule per site, enables upsert semantics for Screens 8/9
scripts/
  day1-gate.ts            the cost gate above
  verify-pipeline.ts      the pipeline check above
```

## Live Run streaming (Screen 4)

In `AGENT_MODE=stub`, `runWorker.ts` writes incrementally instead of
batching a whole attempt at once: it inserts the `attempts` row first
(`outcome: null`), then one `run_steps` row per step as
`stubRunAgentAttempt.ts`'s `streamStubSteps` generator produces it, upserting
`checkpoints` after every step. The frontend (`src/pages/LiveRun.tsx`)
subscribes to Postgres changes on those tables via `supabase.channel(...)`
— no polling. RLS already scopes delivery to the current user's own rows,
so no extra auth wiring was needed for Realtime itself.

One real bug worth knowing about if you touch this: there's an unavoidable
gap between the frontend's initial `GET /runs/:id` fetch and the Realtime
channel reporting `SUBSCRIBED` — anything the worker writes in that gap is
silently missed (Realtime doesn't replay past events). `LiveRun.tsx` closes
it by re-running the fetch-and-merge (`hydrate()`) the moment the channel
subscribes, unioning by id/name rather than overwriting so a slightly-late
refetch can never regress data that already arrived live. Caught this via
the browser verification below — the DB had all 6 steps of attempt 1, the
UI was silently missing the first one.

## Public share page (Screen 6)

`POST /runs/:id/share` (owner-only) sets `is_public`/`public_slug` on a run,
idempotently. `GET /public/runs/:slug` is the canonical share page —
server-rendered HTML with OG tags by default (a share link needs real
content for social crawlers and no-JS clients, not an empty SPA shell), or
JSON if the request sends `Accept: application/json`. Only score,
checkpoints, video (if any), and site label are exposed — never the fix
list, goal text, or owner info.

Both this route and `/public/samples` use `getSupabasePublic()`
(`src/lib/supabase.ts`) — an anon-key client, not the service-role one —
so row visibility is actually enforced by Postgres RLS. That distinction
caught a real bug: 0004's `sites_select_via_public_run` policy had an
unqualified `id` inside its `EXISTS` subquery that Postgres resolved to
the subquery's own `runs.id` (column shadowing) instead of the intended
outer `sites.id`, compiling to `r.site_id = r.id` — always false. The
policy existed, looked correct on read, and simply matched zero rows;
found it by querying `pg_policies` directly and comparing the compiled
`qual` against intent, not by reading the SQL again. Fixed in 0005 by
qualifying the reference explicitly (`r.site_id = sites.id`). Verified
both directions afterward with direct anon-client queries bypassing the
app entirely: a public run's site *is* readable, a private one's isn't.

## Dashboard, site detail, monitoring (Screens 7/8/9)

`GET /sites` (Screen 7) joins each site to its latest done run, the
previous run's score (for the red-row delta), and a compact sparkline
series — computed in JS from two flat queries (sites, then runs+schedules
by `site_id in (...)`), same pattern as the public-samples route, not a
PostgREST embed. Monitoring state (`monitored` / `not_monitored` /
`never_run`) is derived from whether a schedule row exists — there's no
separate "paused" flag in the schema, so that's genuinely all three states
that exist, not a placeholder for a fourth.

`GET /sites/:id` (Screen 8) returns the site, its full run history, and
its schedule if any. `PUT /sites/:id/alerts` upserts that schedule
(creating one with a default weekly cadence if none exists yet) — so
setting an alert threshold from the site-detail screen also turns
monitoring on, same effect as doing it from Screen 9.

`/schedules` (Screen 9) is full CRUD now: `GET` (list, joined with site
label), `POST` (create — 409s if the site already has one, since
`schedules_site_id_unique` makes that a real constraint, not just a UI
assumption), `PUT /:id` (partial update), `DELETE /:id` (turn monitoring
off — deletion, not a fabricated pause flag). **None of this is acted on
yet** — there's no recurring BullMQ job reading these schedules, enqueuing
runs on cadence, or comparing scores to fire alerts. The Monitoring page
says so directly rather than implying schedules do something they don't.

## Safety, encoded not just documented

`runAgentAttempt.ts` enforces the "never pays" rule twice: it stops the
loop the instant the `reached_checkout` checkpoint passes, and it
independently rejects any action whose target text matches a
payment/order-submission pattern, regardless of which checkpoint state
triggered it. If you add new `AgentActionType` values, check whether
`FORBIDDEN_ACTION_TARGETS` in that file needs to grow with them.

## Not built yet (see spec's build order for the rest)

Fix generation, the recurring scan job + email alerts actually firing,
billing, clients/agency workspace, and all hardening (bot-protection
detection, retries) — these come after the gate passes and the agent loop
is real, per the spec's own ordering. Screens 1/3/4/5/6/7/8/9 (landing /
new test / live run / result / public share / dashboard / site detail /
monitoring settings) are now real end to end in stub mode.
