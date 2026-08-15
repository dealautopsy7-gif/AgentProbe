# PROJECT_MAP.md — orientation for an AI assistant picking this up cold

Read this first, before grepping the codebase. It's written so you can be productive in minutes, not hours.
Every claim in this file was checked against the actual code on 2026-08-13, not written from memory.

---

## 1. What this project is

AgentProbe sends a real AI agent to a website and tries to make it buy something — the way an AI shopping
agent (not a human) would. It scores the site 0-100 on whether an agent can actually complete a purchase,
records video of exactly where the agent got stuck, and generates a plain-English fix list for the failure
points. It's aimed at e-commerce site owners who want to know if their store is "agent-ready" before AI
shopping agents become a real traffic source. Re-runs on a schedule and alerts on score drops; has an
agency tier for managing multiple client sites with white-labeled reports.

**Current status:** all 12 screens are built and working. `AGENT_MODE=stub` is the default everywhere — a
fake agent exercises the real scoring/checkpoint/DB pipeline at zero cost. `AGENT_MODE=live` with
`BROWSER_PROVIDER=local` (real browser, real AI reasoning) is **built and verified working** — a real run
was pushed through the actual app end-to-end, including video and Realtime streaming. It has never been
flipped on as the persisted default, and the product has not been deployed or sold to anyone yet.

---

## 2. How to run it locally

This is **not a monorepo**. The repo root *is* the frontend app (Vite/React). `server/` is a separate
Node/Express package with its own `node_modules` and `package.json`. Run each from its own directory.

**Prerequisites:**
- Redis running and reachable at `REDIS_URL` (default `redis://localhost:6379`). Either a local install, or
  `cd server && docker-compose up redis` (that compose file also has a self-hosted Steel.dev service, only
  needed for `BROWSER_PROVIDER=steel`).
- `server/.env` must exist — copy `server/.env.example` and fill in at minimum `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. **Missing any of these fails fast and loudly**: the
  first call to `getEnv()` (`server/src/config/env.ts`) throws a zod validation error listing exactly
  what's missing — it does not run half-configured or silently no-op.
- Root `.env.local` (copy `.env.local.example`) needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_API_URL` (defaults to `http://localhost:8787`).

**Commands (three separate terminals/processes):**

```bash
# API server (port 8787)
cd server && npm run dev

# Worker — separate process, required for runs to actually process.
# Without this running, POST /runs succeeds but the run sits at 'queued' forever.
cd server && npm run worker

# Frontend (port 5173)
npm run dev          # from repo root, NOT server/
```

Other useful commands:
```bash
cd server && npm run typecheck   # tsc --noEmit
cd server && npm run build       # tsc -p tsconfig.json -> dist/
cd server && npm run gate        # Day-1 cost gate, see section 3
npx tsc --noEmit -p tsconfig.app.json   # frontend typecheck, from repo root
npm run build                     # frontend build (vite), from repo root
```

Both apps currently typecheck and build clean.

---

## 3. The `AGENT_MODE` switch — the single most important concept here

Read in `server/src/config/env.ts` (`AGENT_MODE: z.enum(["stub", "live"]).default("stub")`), consumed in
`server/src/workers/runWorker.ts`'s `processRun()`.

### `stub` (default)
`server/src/agent/stubRunAgentAttempt.ts` generates a fake but *plausible* step-by-step trace — no browser,
no API calls, zero cost. Critically, those fake steps are still run through the **real**
`evaluateCheckpoints()` (`server/src/agent/checkpoints.ts`) and `computeScore()`
(`server/src/agent/scoring.ts`) — so the entire scoring/checkpoint/fix-generation/DB/Realtime pipeline is
exercised for real, only the "did an agent actually click this" part is faked.

### `live` — branches again on `BROWSER_PROVIDER`
```
env.ts: BROWSER_PROVIDER = "local" (default) | "steel" | "browserbase"
```

- **`local`** (default, and the one that's actually built and tested): `runWorker.ts` →
  `runLocalLiveAttempt()` → `server/src/agent/runStagehandAttempt.ts`. Launches a real Chromium **on this
  machine** via Stagehand (pinned to `3.7.1` — see section 5 for why). Each step: this loop asks the
  configured reasoning model (see `AGENT_LLM_PROVIDER` below) "what's the next step" (structured JSON
  output), then hands the resulting natural-language instruction to `stagehand.act()`, which does the actual
  DOM grounding and execution. So each step is genuinely **~2 real model calls**, not 1. Screenshots are
  captured each step and assembled into a video afterward (`videoPipeline.ts`). No cloud browser cost, no
  Steel/Browserbase account needed.
- **`steel` / `browserbase`**: `runWorker.ts` → `runSteelLiveAttempt()` → `server/src/agent/runAgentAttempt.ts`
  — the *original* spec's path: coordinate-based clicks output directly by a dedicated computer-use model
  (`GeminiComputerUseDriver.ts`), executed against a browser reached via CDP (`chromium.connectOverCDP`).
  Steel's provider (`SteelBrowserProvider.ts`) is real and was verified working against a self-hosted
  instance. **Browserbase's provider is a stub that throws `"not implemented yet"` if selected** — see
  section 6.

These two live paths are genuinely different code (different action representation — coordinates vs.
natural language — and different browser lifecycle ownership), not just different config on one loop. Don't
try to unify them without a reason; the split is deliberate.

### `AGENT_LLM_PROVIDER` — which model does the *reasoning* (local path only)

A **separate, orthogonal** switch from `BROWSER_PROVIDER`: that one picks the browser, this one picks the
brain. Only consulted when `BROWSER_PROVIDER=local` (the steel/browserbase path uses
`GeminiComputerUseDriver` by definition). Read in `env.ts`, resolved in
`server/src/agent/stagehand/index.ts`'s `getAgentLLMClient()`.

```
AGENT_LLM_PROVIDER=aicredits (default)  →  AICreditsLLMClient      — PROVEN, real runs, real cost measured
AGENT_LLM_PROVIDER=gemini               →  GeminiDirectLLMClient   — BUILT + WIRED, but NEVER CALLED FOR REAL
```

Both extend Stagehand's own abstract `LLMClient` (that *is* the shared interface — no need to invent a
second one) and additionally satisfy `AgentLLMClient` (`agent/stagehand/AgentLLMClient.ts`), which adds
`getUsage()` for token/cost accounting Stagehand has no concept of.

**Deliberately NOT a silent fallback chain** like the fix generators'. A fix list quietly degrading to
templated output is fine; silently swapping the *agent's brain* to a different vendor mid-run would
invalidate the exact cost/quality comparison this switch exists to enable. So a missing key **throws**,
before a browser launches or a token is spent — verified at two layers (the factory, and `env.ts`'s
startup validation when `AGENT_MODE=live`).

**The Gemini path has never made a real API call** — there's no funded key (free-tier keys 0-quota-fail).
Its wiring, fail-fast, request translation, and usage accounting were verified via intercepted HTTP, but
whether Gemini *accepts* the request is unknown until Aug 20. See `LIVE-READINESS.md` → "What's verified vs.
what isn't". `AICREDITS` remains the only proven reasoning path.

**Two different Gemini models, don't conflate them:**
| Env var | Used by | Job |
|---|---|---|
| `GEMINI_AGENT_MODEL` (default `gemini-2.5-pro`) | local path, `AGENT_LLM_PROVIDER=gemini` | general vision+reasoning; Stagehand does the clicking |
| `GEMINI_COMPUTER_USE_MODEL` | steel/browserbase path only | dedicated computer-use model that emits click coordinates itself |

### Fix generator's 3-way fallback
`server/src/agent/fixGenerators/index.ts`, `getFixGenerator()`:
```
AICREDITS_API_KEY set  →  AICreditsFixGenerator  (real call, "json_object" mode)
      ↓ (if unset)
DEEPSEEK_API_KEY set   →  DeepSeekFixGenerator    (real call, same shape, unconfigured currently)
      ↓ (if unset, or if either live generator's call fails for ANY reason)
                        →  TemplateFixGenerator    (regex-matched, no API call, never fails)
```
This selection is independent of `AGENT_MODE` — fix generation is a cheap text call, unrelated to the
agent's browser-automation cost.

### `BrowserProvider` abstraction
`server/src/agent/BrowserProvider.ts` — interface with `createSession()`/`closeSession()`, returning a CDP
`connectUrl`. **Only used by the `steel`/`browserbase` path.** `BROWSER_PROVIDER=local` does not go through
this interface at all — Stagehand owns its own browser lifecycle directly. This is a deliberate
architectural split, not an oversight (see `runStagehandAttempt.ts`'s file-level comment).

### Real cost, measured
`npm run gate` (`server/scripts/day1-gate.ts`) branches on both switches, and takes an optional
`--provider=aicredits|gemini` flag that overrides `AGENT_LLM_PROVIDER` for one run — so you can A/B two
providers without editing `.env` between runs:
```bash
cd server && npm run gate                          # uses AGENT_LLM_PROVIDER from .env
cd server && npm run gate -- --provider=gemini      # override for this run only
```
Cost reporting differs by provider, and the output labels which you got:
- **AICredits** self-reports real billed cost per call (`usage.cost`), accumulated via `getUsage()`. Not an
  estimate. Measured real result: **₹4.75 (~$0.055 at ₹87/$) for a 3-step attempt** against
  `https://www.allbirds.com` — comfortably under the spec's $0.40 ceiling.
- **Gemini** does *not* report cost, so the gate **estimates** from token counts using constants at the top
  of `day1-gate.ts`, and says so explicitly in the output. `getUsage().costInr` is `null` (deliberately not
  `0`) for this provider so nothing mistakes "can't tell" for "free". Verify those rate constants against
  ai.google.dev before trusting the number.

Note the gate calls the attempt runner directly, so `AGENT_MODE` doesn't gate it — but keep `AGENT_MODE`'s
persisted value as `stub` and use a one-off override (`AGENT_MODE=live npm run gate`) rather than editing
`.env`.

---

## 4. Directory structure

```
AgentProbe/                           repo root = the frontend app itself (NOT a monorepo wrapper)
  src/                                 Vite/React frontend
    pages/                             one file per screen
      Landing.tsx                      Screen 1 — public landing, real public-samples fetch
      Auth.tsx                         Screen 2 — Supabase email/password + Google OAuth
      NewTest.tsx                      Screen 3 — goal builder; POST /runs; shows plan-limit 402s inline
      LiveRun.tsx                      Screen 4 — Realtime-streamed viewer (postgres_changes, not polling)
      Result.tsx                       Screen 5 — score/checkpoints/fixes/video; 45s fix-gen poll window (§6)
      Dashboard.tsx                    Screen 7 — site list, sparkline, monitoring-state chip
      SiteDetail.tsx                   Screen 8 — score trend chart, run history, "changes detected" banner
      Monitoring.tsx                   Screen 9 — schedule CRUD (cadence, alert channel)
      Clients.tsx                      Screen 10 — agency client grouping, white-labeled report links
      Billing.tsx                      Screen 11 — plan/usage display, real (key-gated) Stripe checkout
      Settings.tsx                     Screen 12 — profile, alert channels, delete-account
      (Screen 6, public share, is server-rendered — see server/src/views/, not a page here)
    components/
      Sidebar.tsx                      app-shell nav, all screens except Landing/Auth
      RequireAuth.tsx                  route guard — redirects to /auth if no session
      Logo.tsx                         brand mark
    context/
      AuthContext.tsx                  Supabase session state, sign-in/up/out
      TestConfigContext.tsx            cross-page state for New Test -> Live Run -> Result handoff
    lib/
      api.ts                           every backend fetch call, typed
      supabase.ts                      browser Supabase client (anon/publishable key only)
      checkpoints.ts                   display labels mirroring the server's checkpoint definitions
    App.tsx                            all routes

  server/                              Node/Express backend — separate package, own node_modules
    src/
      index.ts                         Express entry; mounts all routers; Stripe webhook raw-body route
      config/env.ts                    every env var validated here (zod); AGENT_MODE=live fail-fast refines
      workers/runWorker.ts             BullMQ worker — processRun() branches stub/local-live/steel-live;
                                        also runs the schedule-tick repeatable job
      agent/
        AgentDriver.ts                  interface: decideNextAction() -> coordinate-based action (steel path)
        BrowserProvider.ts              interface: createSession/closeSession -> CDP connectUrl (steel path)
        runAgentAttempt.ts               coordinate-based observe/decide/act loop — steel/browserbase path
        runStagehandAttempt.ts           THE REAL local live loop — Stagehand + the AGENT_LLM_PROVIDER
                                          client, natural-language actions, verified against real runs
        stubRunAgentAttempt.ts           fake step generator for AGENT_MODE=stub, still real checkpoint logic
        checkpoints.ts                   the 6-checkpoint ecommerce rubric + evaluateCheckpoints()
        scoring.ts                       computeScore() — weighted checkpoint avg blended with completion rate
        fixGeneration.ts                 generateFixes(), called by runWorker.ts after every run
        videoPipeline.ts                 ffmpeg: assembleScreenshotsToVideo() (local) + trimHighlightClip() (both)
        drivers/
          GeminiComputerUseDriver.ts     real Gemini computer-use wiring — untested live (no funded key yet)
        providers/
          SteelBrowserProvider.ts        real, working — self-hosted Steel.dev
          BrowserbaseBrowserProvider.ts  NOT IMPLEMENTED — throws if BROWSER_PROVIDER=browserbase
        stagehand/
          index.ts                       getAgentLLMClient() — AGENT_LLM_PROVIDER selection, throws on missing key
          AgentLLMClient.ts              shared contract: Stagehand's LLMClient + getUsage() token/cost accounting
          AICreditsLLMClient.ts          reasoning via AICredits — the PROVEN path (default)
          GeminiDirectLLMClient.ts       reasoning via Google Gemini directly (@google/genai) — BUILT, NEVER
                                          CALLED FOR REAL (no funded key); expect first-run debugging
        fixGenerators/
          index.ts                       getFixGenerator() — the 3-way fallback selection
          AICreditsFixGenerator.ts       primary — real call, "json_object" mode (see §5 for why not json_schema)
          DeepSeekFixGenerator.ts        second fallback — unconfigured currently, same shape
          TemplateFixGenerator.ts        final fallback — regex-matched, no API call, never fails
          shared.ts                      prompt text + response validation shared by both live generators
      routes/                           one file per resource, all mounted in index.ts
        runs.ts                          POST /runs (+ plan-limit 402), GET /:id, POST /:id/cancel, /share, /video
        sites.ts                         GET /sites (dashboard), GET /:id (site detail + latest alert)
        schedules.ts                     CRUD for Screen 9
        billing.ts                       GET /billing (plan+usage), POST /checkout (real, key-gated)
        stripeWebhook.ts                 POST /stripe/webhook — raw-body route, mounted before express.json()
        clients.ts                       agency clients CRUD, site assignment, POST /:id/report (agency-gated)
        account.ts                       DELETE /account — real cascade delete
        public.ts                        unauthenticated: /public/samples, /public/runs/:slug, /public/reports/:slug
      scheduling/
        scheduleTick.ts                  the repeatable BullMQ job that makes Screen 9's schedules actually fire
        alerts.ts                        score-drop comparison, alerts row, Resend email
      lib/
        supabase.ts                      getSupabase() (service-role) vs getSupabasePublic() (anon, RLS-enforced)
        queue.ts                         BullMQ Queue getters (run queue + schedule-tick queue)
        redis.ts                         shared ioredis connection
        plans.ts                         PLAN_LIMITS — shared by billing.ts display AND runs.ts enforcement
        email.ts                         Resend REST call; honest no-op without a key
      middleware/auth.ts                 requireAuth — verifies Supabase JWT, sets req.userId
      types/db.ts                        hand-written Database type mirroring the SQL schema
      views/                             server-rendered HTML for public pages (OG tags, no client JS)
    db/migrations/                       0001-0011, see the table below
    scripts/
      day1-gate.ts                       cost gate — branches local (real AICredits cost) vs steel (estimated)
      verify-pipeline.ts                 end-to-end pipeline check (kept as a permanent reusable script)
      verify-aicredits-vision.ts         vision sanity-check (takes a screenshot path as argv)
      verify-schedule-tick.ts            recurring-job verification script
      make-test-user.mjs                 creates a throwaway confirmed Supabase user for manual testing
    docker-compose.yml                   Redis + self-hosted Steel.dev
    .env / .env.example                  see section 8

  LIVE-READINESS.md                      step-by-step go-live checklist (local path done, steel/browserbase pending funding)
  PROJECT_MAP.md                         this file
```

### Migrations (`server/db/migrations/`)

| File | What it added |
|---|---|
| `0001_init.sql` | Core schema: sites, runs, attempts, checkpoints, run_steps, fixes, schedules, alerts — RLS on every table |
| `0002_public_sharing.sql` | `is_public`/`public_slug` on runs + public-read RLS, for Screens 1 & 6 |
| `0003_realtime_live_run.sql` | Enables Supabase Realtime on the tables Live Run subscribes to |
| `0004_public_site_label.sql` | Public-read policy so the share page can show a site's label/hostname |
| `0005_fix_public_site_policy.sql` | **Real bug fix** — 0004's policy had an unqualified `id` inside an `EXISTS` subquery; Postgres resolved it to the subquery's own `runs.id` (column shadowing), not the outer `sites.id`, so it silently matched zero rows |
| `0006_schedules_unique_site.sql` | Unique constraint — one monitoring config per site, not a list |
| `0007_run_cancellation.sql` | `'cancelled'` run status + `bullmq_job_id` column, for real Stop-run support |
| `0008_user_plans.sql` | `user_plans` table + `plan_tier` enum for Screen 11; no row = 'free' |
| `0009_clients.sql` | `clients` table + `sites.client_id`, for Screen 10 |
| `0010_client_reports.sql` | `client_reports` table + `clients.brand_color`, white-labeled report RLS chain |
| `0011_fix_report_rls_recursion.sql` | **Real bug fix** — 0010's policies created a `sites ↔ runs` RLS recursion cycle (`"infinite recursion detected"`); fixed with a `SECURITY DEFINER` helper function that bypasses RLS internally to break the cycle |

---

## 5. Key architectural decisions (and why)

- **Stagehand is pinned to exactly `3.7.1`, not `^3.7.1` and not the newer `4.0.0`.** `4.0.0`'s bundled
  browser extension and its Node-side RPC schema are out of sync in the same published release —
  `act()`/`observe()` throw `invalid_union ... discriminator: outputFormat` regardless of which LLM backs
  it, confirmed via a real call. `3.7.1` also turns out not to use the extension architecture at all, which
  is *why* it doesn't hit the original Steel/CDP incompatibility from the initial spec attempt — that
  failure needed an extension's local file path to resolve across a container boundary into a browser
  Stagehand didn't launch itself; a locally-launched browser has no such boundary.
- **`AICreditsLLMClient` uses `response_format: "json_object"`, never `"json_schema"`.** AICredits' Gemini
  route silently returns an empty completion for `json_schema` — real tokens spent, nothing produced.
  `json_object` with the schema described in the prompt text works (confirmed via a real `act()` call that
  actually clicked a real link and navigated). Don't "clean this up" back to the standard OpenAI pattern
  without re-testing against a real call first.
- **`Result.tsx`'s fix-list poll keeps checking for 45 seconds after a run's `finished_at`, not 0.** Fix
  generation happens *after* the run is marked done, via a real model call that can take real seconds (a
  measured real case took 21.6s). The original polling logic stopped the instant `status` became `"done"`,
  so a fix list that arrived a few seconds late was silently never shown — found by actually watching a run
  in the browser without reloading, not by reading the code.
- **The `sites` public-read RLS policy was rewritten in migration 0005** because of the column-shadowing bug
  described in the migrations table above — found by comparing the *compiled* policy in `pg_policies`
  against intent, not by re-reading the SQL source (which looked correct).
- **Checkout is always simulated, never completed — enforced in three independent places, not one.** (1)
  The checkpoint rubric's highest-weighted step is `reached_checkout`, and there is no checkpoint after it —
  structurally nothing rewards going further. (2) Both attempt loops (`runAgentAttempt.ts` and
  `runStagehandAttempt.ts`) hard-stop the instant that checkpoint passes, before executing whatever the next
  action would have been. (3) Both loops separately run every proposed action's text through a
  `FORBIDDEN_ACTION_TARGETS` regex (`submit.*payment|place.*order|confirm.*purchase|pay now|complete
  purchase`) and refuse to execute a match. This is treated as non-negotiable — don't add a
  "complete purchase" checkpoint or relax the forbidden-action filter.
- **`runStagehandAttempt.ts` writes each step to the DB incrementally via an `onStep` callback**, not as one
  batch at the end. The original `steel`/`browserbase` live path *does* batch (insert everything after the
  whole attempt finishes) — that was fine when nothing exercised it, but a real local live run takes real
  wall-clock time per step, and Live Run's Realtime subscription would otherwise show nothing happening for
  the entire attempt and then dump everything at once. If the steel/browserbase path ever gets real traffic,
  it should probably get the same treatment.

---

## 6. Known issues / things to watch

- **`BrowserbaseBrowserProvider` is not implemented.** `createSession()`/`closeSession()` both throw
  `"not implemented yet"`. Setting `BROWSER_PROVIDER=browserbase` in live mode will fail loudly the moment a
  run actually tries to use it — this is intentional (the TODO in the file explains exactly what's missing:
  install the SDK, create a session, map it to `{id, connectUrl}`), not a silent gap.
- **Stripe payment collection is not wired.** `POST /billing/checkout` and `POST /stripe/webhook` are real,
  working code (real REST calls to Stripe, real HMAC signature verification, no SDK dependency) — but both
  answer honestly with `501` until `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/price ids exist. The frontend
  Billing page calls the real endpoint and shows its honest response, not a fake success.
- **ffmpeg's `drawtext` filter needed comma-escaping, found via a real run.** `videoPipeline.ts`'s caption
  burn-in originally escaped `:` and `'` but not `,` — a real agent-generated caption containing a comma
  broke ffmpeg's filtergraph parser (`No such filter: 'and its price'`, since `,` separates filters, not
  just option values). Fixed with full escaping (backslash first, then `:`/`,`/`%`, then `'`). If you ever
  touch this function, re-test with a caption containing a comma before trusting it.
- **The step-decision schema in `runStagehandAttempt.ts` uses `.nullish()`, not `.optional()`, for
  `instruction`/`value`.** The model sometimes returns explicit `null` for fields that don't apply to the
  chosen action type (e.g. `instruction` when `type` is `"wait"`) rather than omitting the key —
  `.optional()` alone rejects an explicit `null` and crashed a real in-progress paid run before this was
  fixed. Downstream, `null` is normalized to `undefined` before it reaches `AgentAction`.
- **Local-mode video is a screenshot-assembled low-fps (1fps) mp4, not a true continuous recording.**
  Stagehand's local `Page` wraps its own lightweight CDP connection, not a Playwright `BrowserContext` with
  a `recordVideo` hook to attach to — so `videoPipeline.ts`'s `assembleScreenshotsToVideo()` turns the
  per-step screenshots (already being taken for the reasoning loop) into a real, honest video instead. It's
  genuinely what happened, just not smooth 30fps footage.
- **`checkpoints.ts`'s `evaluateCheckpoints()` is a documented placeholder heuristic** — regex/keyword
  matching against each step's `type`/`target`/`reasoning` text, not a structured signal from the driver.
  The file's own comment flags this as a TODO. It works well enough that nothing downstream has needed to
  change, but it's worth knowing it's pattern-matching text, not reading real page state.
- **`GEMINI_API_KEY` is present in `server/.env` but is not a working key** — it hit the free tier's
  zero-quota limit in earlier testing and Gemini/GCP billing has not been funded. Its presence in `.env`
  doesn't mean the `steel`/`browserbase` path or `AGENT_LLM_PROVIDER=gemini` is usable; both default away
  from it (`BROWSER_PROVIDER=local`, `AGENT_LLM_PROVIDER=aicredits`) specifically because those paths don't
  need it. **A consequence worth knowing:** because the key is *present but dead*, setting
  `AGENT_LLM_PROVIDER=gemini` today will pass every fail-fast check (they test presence, not validity) and
  then fail at the first real API call instead. That's expected — validity can only be checked by spending.
- **`GeminiDirectLLMClient` has never made a real API call.** It typechecks, and its wiring/fail-fast/
  request-translation/usage-accounting were verified via intercepted HTTP — but whether Gemini *accepts*
  the translated request is genuinely unknown. Treat first real use as a debugging session, not a smoke
  test. Details in `LIVE-READINESS.md` → "What's verified vs. what isn't".
- **Redis version warning** (`recommended minimum 6.2.0, current 6.0.16`) prints on every BullMQ connection
  in this dev environment. Harmless, safe to ignore — not investigated further since it's a local dev
  environment quirk, not a deployed one.
- **Frontend bundle size warning** on `npm run build` (`some chunks are larger than 500 kB`) — cosmetic,
  not yet addressed with code-splitting. Not urgent at current scale.
- **Run-level `cost_usd` is not populated yet.** `runWorker.ts` tracks `totalInputTokens`/`totalOutputTokens`
  per run but doesn't yet convert them to a stored dollar figure on the `runs` row — there's a `TODO` comment
  at that exact spot. The gate script computes and prints cost standalone; wiring the same math into the
  worker is a small, not-yet-done follow-up.

---

## 7. "If you need to..." quick reference

| Need to... | Look at... |
|---|---|
| Change local-mode agent behavior/prompting | `server/src/agent/runStagehandAttempt.ts` (the `decideNextStep()` prompt + `NEXT_STEP_SCHEMA`) |
| Change how Stagehand talks to AICredits | `server/src/agent/stagehand/AICreditsLLMClient.ts` |
| Switch the agent's reasoning model | `AGENT_LLM_PROVIDER` in `server/.env` (`aicredits`\|`gemini`) — no code change |
| Debug/adjust the Gemini reasoning client | `server/src/agent/stagehand/GeminiDirectLLMClient.ts` (read its header comment first — it's untested against a real key) |
| Add a third reasoning provider | new client in `server/src/agent/stagehand/` implementing `AgentLLMClient`, then a branch in that folder's `index.ts` |
| Compare provider cost/quality | `cd server && npm run gate -- --provider=gemini` vs `--provider=aicredits` |
| Add a new checkpoint type | `server/src/agent/checkpoints.ts` (`CHECKPOINT_DEFINITIONS` + `evaluateCheckpoints`) — also mirror the label in `src/lib/checkpoints.ts` for display |
| Change scoring weights/formula | `server/src/agent/scoring.ts` |
| Change fix-generation logic/prompt | `server/src/agent/fixGenerators/` — `shared.ts` for the shared prompt, or the specific generator |
| Add a new screen | `src/pages/`, then wire the route in `src/App.tsx`, then a nav entry in `src/components/Sidebar.tsx` |
| Change pricing/plan limits | `server/src/lib/plans.ts` (`PLAN_LIMITS` — single source used by both display and enforcement) |
| Debug a Realtime streaming issue | `src/pages/LiveRun.tsx` — read the `hydrate()`/subscription-gap comments first, there's real race-condition history there |
| Debug why fixes aren't showing up | `src/pages/Result.tsx`'s poll logic (the 45s window) first, then `server/src/agent/fixGeneration.ts` |
| Add/change a live-mode env var | `server/src/config/env.ts` — update the zod schema AND `server/.env.example` together |
| Check current env var requirements | `server/.env.example` (kept in sync with `env.ts`) |
| Run the cost gate before spending real money | `cd server && npm run gate` (reads `GATE_TARGET_URL`/`GATE_TARGET_GOAL` from `.env`) |
| Understand what's safe to flip to live | `LIVE-READINESS.md` |
| Touch RLS policies | Read migrations 0005 and 0011 first — both are real bugs found in RLS policies that *looked* correct in the source SQL; verify against the compiled `pg_policies` output, not just the file |
| Wire up real Stripe payments | `server/src/routes/billing.ts` (`POST /checkout`) and `server/src/routes/stripeWebhook.ts` — both already have real, working code, just need keys in `.env` |
| Change the video pipeline | `server/src/agent/videoPipeline.ts` — re-read the ffmpeg escaping note in section 6 before editing `trimHighlightClip` |

---

## 8. Credentials status

Checked directly against `server/.env` on 2026-08-13 (presence/absence only, no values shown):

```
[x] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY — set
[x] DATABASE_URL — set (superuser, gitignored, for direct psql/migrations access)
[x] AICREDITS_API_KEY / AICREDITS_BASE_URL / AICREDITS_MODEL — set, has real credit, verified working
[ ] AICREDITS_AGENT_MODEL — not written to .env, code default (google/gemini-2.5-pro) applies and is verified working
[x] GEMINI_API_KEY — set, BUT NOT FUNCTIONAL — hit free-tier zero-quota in earlier testing; GCP billing not funded.
    Present-but-dead means fail-fast checks (which test presence) pass and the first real call fails instead.
[x] GEMINI_COMPUTER_USE_MODEL — set (a pinned model id); used ONLY by the steel/browserbase path
[ ] GEMINI_AGENT_MODEL — not written to .env; code default (gemini-2.5-pro) applies. Used ONLY when
    AGENT_LLM_PROVIDER=gemini on the local path. Verify the id at ai.google.dev before first real use.
[ ] AGENT_LLM_PROVIDER — not written to .env; code default "aicredits" (the proven path) applies
[x] STEEL_API_URL — set (default self-hosted URL)
[ ] STEEL_API_KEY — empty (not needed for self-hosted; only needed for cloud Steel)
[ ] BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID — empty, and the provider class isn't implemented regardless
[ ] RESEND_API_KEY — empty; alerts write to the DB but the email step only logs "would send"
[ ] DEEPSEEK_API_KEY — empty; unused second-tier fix-generation fallback
[ ] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID_PRO / STRIPE_PRICE_ID_AGENCY — all empty; payment collection not wired
[x] VIDEO_STORAGE_BUCKET — "run-videos", bucket created in Supabase Storage and confirmed working with a real uploaded/downloaded video
[ ] BROWSER_PROVIDER / LOCAL_CHROME_PATH / DEEPSEEK_MODEL / SCHEDULER_TICK_MS / RESEND_FROM_EMAIL — not written to .env; all have sensible code defaults (see server/.env.example)

AGENT_MODE=stub (the persisted default — has never been changed to "live" in .env; all live-mode
verification used a one-off shell env override on a single process, never the checked-in file)
```
