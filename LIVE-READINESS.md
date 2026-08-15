# Going live — what actually has to happen

Two independent switches control the live agent. Don't confuse them:

- **`BROWSER_PROVIDER`** — *which browser*. `local` (default: real Chromium on this machine, Stagehand
  drives it) vs `steel`/`browserbase` (a remote/hosted browser over CDP).
- **`AGENT_LLM_PROVIDER`** — *which brain*, and only consulted when `BROWSER_PROVIDER=local`.
  `aicredits` (default) vs `gemini` (Google's API directly).

That gives three usable combinations:

| Combination | Status |
|---|---|
| `local` + `aicredits` | **Built and proven end to end.** Real runs, real video, real cost measured (₹4.75/attempt). This is Path A. |
| `local` + `gemini` | **Built and wired, never executed** — no funded Gemini key exists yet. Structurally verified, expect first-run debugging. This is Path A-Gemini. |
| `steel`/`browserbase` | Original spec's path (Gemini computer-use + hosted browser). Blocked on funding. This is Path B. |

## Path A: local mode (recommended first — already working, nothing to fund)

1. `AICREDITS_API_KEY` is already set in `server/.env` and has credit — nothing to add.
2. The `run-videos` Supabase Storage bucket already exists (created directly via the service-role key while
   verifying this). Nothing to do here either.
3. Set `AGENT_MODE=live` in `server/.env` (leave `BROWSER_PROVIDER=local`, its default).
4. Restart the API and worker.
5. Run the Day-1 gate to see real cost before pointing it at anything else:
   ```
   cd server && npm run gate
   ```
   This calls `runStagehandAttempt.ts` directly against `GATE_TARGET_URL`/`GATE_TARGET_GOAL` (currently
   allbirds.com, find-a-product-and-read-its-price, no cart/checkout) and prints AICredits' own
   **self-reported real INR cost** for that attempt — not an estimated $/token rate, the actual number
   AICredits billed. A real run during verification cost **₹4.75 (~$0.055)** for a 3-step attempt, comfortably
   under the $0.40 ceiling.
6. If the cost looks right, run a real test from the UI same as any stub run — New Test → Live Run → Result.
   Live Run streams real steps as they happen (not a batch dump at the end — see "Verified, for real"), and
   Result gets a real playable video.

**Cost note:** each step makes ~2 real model calls — this loop's own "what's next" decision, plus
Stagehand's internal grounding call for whatever instruction gets handed to `act()`. Both are billed and
both are included in the gate script's reported total, but it's worth knowing going in that step count
roughly doubles the call count versus a naive single-call-per-step estimate.

## Path A-Gemini: same local browser, Google's API instead of AICredits (Aug 20+)

Everything about the browser/loop/video stays identical — only the reasoning client swaps. No code changes
needed, one env var.

1. Fund GCP billing + AI Studio prepay. **Confirm the project shows a paid tier before creating a key** —
   a free-tier key 0-quota-fails, which is exactly what happened with the key currently sitting in `.env`.
2. Create a Gemini API key under the now-paid project.
3. In `server/.env` set:
   ```
   GEMINI_API_KEY=<paste here>
   GEMINI_AGENT_MODEL=gemini-2.5-pro     # verify the current id at ai.google.dev
   AGENT_LLM_PROVIDER=gemini
   ```
   **Note:** `GEMINI_AGENT_MODEL` — *not* `GEMINI_COMPUTER_USE_MODEL`. Those are two different models for
   two different code paths: the agent model is a general vision+reasoning model (Stagehand does the
   clicking, the model just decides what to do next), whereas the computer-use model emits click
   coordinates itself and is only used by Path B. Setting the computer-use model here would be wrong.
4. Keep `AGENT_MODE=live` and `BROWSER_PROVIDER=local`.
5. Restart the API and worker.
6. Run the gate against Gemini:
   ```
   cd server && npm run gate -- --provider=gemini
   ```
   The `--provider` flag overrides `AGENT_LLM_PROVIDER` for that one run, so you can A/B without editing
   `.env` between runs:
   ```
   cd server && npm run gate -- --provider=aicredits   # the ₹4.75 baseline
   cd server && npm run gate -- --provider=gemini      # the new number
   ```
7. Compare cost **and** output quality (the gate prints the full step-by-step reasoning trace for both)
   against the AICredits baseline of **₹4.75 / ~$0.055 per 3-step attempt** before deciding which to keep.
8. If satisfied, run a real test through the UI and/or leave `AGENT_LLM_PROVIDER=gemini` in `.env`.

**Expect to debug this on first run.** The Gemini client has never made a real API call — see
"What's verified vs. what isn't" below for exactly what was and wasn't checked. Two things most likely to
need attention:
- **Cost is an *estimate*, not a billed figure.** Gemini's API doesn't report cost back the way AICredits
  does, so the gate estimates from token counts using constants at the top of `day1-gate.ts`. Verify those
  rates against ai.google.dev for whatever model you actually use — the output labels this clearly as an
  estimate, but the constants are only as current as the day they were written.
- **Structured output uses `responseMimeType: "application/json"` + the schema described in the prompt,
  deliberately not Gemini's native `responseSchema`.** Gemini's `responseSchema` accepts only an OpenAPI
  subset and rejects things `zodToJsonSchema` emits (`$schema`, `additionalProperties`, `$ref`). If the
  in-prompt approach turns out to be unreliable in practice, switching to a sanitized `responseSchema` is a
  contained change inside `GeminiDirectLLMClient.ts`.

If Gemini disappoints, switching back is one line: `AGENT_LLM_PROVIDER=aicredits`. Nothing else changes.

## Verified, for real (not just "should work")

This was actually run against a real site during this build, more than once, and two real bugs were found
and fixed by doing so rather than by reading the code:

- **Stagehand version matters.** `@browserbasehq/stagehand` is pinned to `3.7.1` exactly (`--save-exact` in
  `package.json`) — the newer `4.0.0` has an internal bug where its bundled browser extension and the
  Node-side RPC schema are out of sync (`act()`/`observe()` throw `invalid_union ... discriminator:
  outputFormat` regardless of which LLM backs it). Don't bump this dependency without re-testing a real
  `act()` call first. 3.7.1 also doesn't use the extension architecture that made Stagehand incompatible
  with Steel in the original spec's testing — a locally-launched browser has no container boundary for an
  extension's file path to fail to resolve across, which is specifically why local mode works where the
  Steel attempt didn't.
- **AICredits' `response_format: "json_schema"` silently fails on their Gemini route** — burns real tokens,
  returns an empty completion. `AICreditsLLMClient` uses `"json_object"` with the schema described in-prompt
  instead (same approach as `AICreditsFixGenerator`). Don't switch this back without re-testing.
- **ffmpeg's `drawtext` filter needed comma-escaping**, not just colon/quote — a real agent caption
  containing a comma (`"...CRUISER', and its price..."`) broke the filtergraph parser
  (`No such filter: 'and its price'`) before this was fixed in `videoPipeline.ts`.
- **The step-decision schema needed `.nullish()`, not `.optional()`** — the model sometimes returns explicit
  `null` for fields that don't apply to the chosen action type (e.g. `instruction` when `type` is `"wait"`)
  rather than omitting the key; plain `.optional()` rejected that and crashed a real in-progress run.

All four are fixed in the code already; this list exists so a future "let's upgrade Stagehand" or "let's
swap the response format back" doesn't silently reintroduce a real, previously-hit failure.

A full real run through the actual app (not a standalone script) was verified end-to-end: real incremental
`run_steps` writes during the run (Live Run's Realtime subscription would show them arriving live, not all
at once at the end), a real final score, a real ~200KB mp4 uploaded to Supabase Storage and downloaded back
to confirm it's a genuinely valid video file, and the free-tier plan gate correctly blocking a second run
for the same account — all real, all checked against the database and the storage bucket directly, not
assumed from the code.

### What's verified vs. what isn't, for the Gemini path specifically

Everything above describes `AGENT_LLM_PROVIDER=aicredits`. The Gemini client was added later and **has
never made a real API call.** Being precise about the line, since "it's built" and "it works" are different
claims:

**Verified (no API key needed, done via intercepted HTTP):**
- The factory returns `GeminiDirectLLMClient` for `gemini` and `AICreditsLLMClient` for `aicredits`/default.
- Missing `GEMINI_API_KEY` fails immediately with an actionable message, at two independent layers: the
  factory (before a browser launches or a token is spent) and `env.ts`'s startup validation.
- An unknown `AGENT_LLM_PROVIDER` value throws rather than silently falling back to a different vendor.
- The request translation produces the right shape: `system` messages lifted to `systemInstruction`,
  `assistant` → `model` role, image data-URIs → `inlineData` with the right mime type, and
  `responseMimeType: "application/json"` set with the schema described in-prompt.
- The response path parses, strips stray code fences, and Zod-validates before returning.
- Usage accounting counts 2.5-series **thinking tokens as output** (they're billed that way), and reports
  `costInr: null` — deliberately not `0`, so nothing can mistake "provider doesn't report cost" for "free".
- Refactoring the shared client interface did **not** regress AICredits' cost/token accumulation.

**NOT verified (needs a funded key):**
- That Gemini accepts the translated request at all.
- That `responseMimeType: "application/json"` + in-prompt schema reliably yields parseable JSON from this
  model, run after run.
- Real cost, real latency, real reasoning quality versus AICredits.
- Whether `gemini-2.5-pro` is even the right model choice for this loop.

## Path B: real Gemini computer-use + Steel/Browserbase (later, cloud-scale)

Unchanged from before — this is the original spec's path, for when there's a reason to move past local
testing (higher fidelity from a dedicated computer-use model, or running somewhere other than this machine).

1. Fund GCP billing + AI Studio prepay for the project that will hold the Gemini key. Confirm the project
   shows a paid tier before creating a key (a free-tier key 0-quota-fails, per this cycle's history — see
   `AgentProbe frontend build` memory).
2. Create a Gemini API key under the now-paid project. Set `GEMINI_API_KEY` in `server/.env`. Set
   `GEMINI_COMPUTER_USE_MODEL` to the current pinned computer-use model id — verify the exact string in
   Gemini's docs at the time (`server/src/agent/drivers/GeminiComputerUseDriver.ts` is where it's consumed).
3. Pick a browser provider:
   - **Steel.dev (self-hosted)**: `docker-compose up` in `server/`, then set `STEEL_API_URL` (defaults to
     `http://localhost:3000`) and `STEEL_API_KEY`.
   - **Browserbase**: set `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`.
4. Set `BROWSER_PROVIDER=steel` (or `browserbase`) in `server/.env`.
5. Set `AGENT_MODE=live`.
6. Run `npm run gate` — for this path it uses `runAgentAttempt.ts` + `GeminiComputerUseDriver`, and needs
   the hardcoded `$/token` pricing constants at the top of `day1-gate.ts` kept current (Gemini's API doesn't
   self-report cost the way AICredits does).
7. Proceed only if cost per attempt is ~$0.20–0.40 or less — a redesign trigger if not, not a "spend more
   and hope" situation.

`server/src/config/env.ts` fails fast at startup for either path if `AGENT_MODE=live` and the matching
provider's credentials aren't present — you cannot accidentally boot into live mode half-configured, for
either path.

## Optional, not required for either path

- `RESEND_API_KEY` — score-drop alert emails. Without it, alerts still write to the `alerts` table; the
  email step just logs "would send". Safe to leave unset.
- `DEEPSEEK_API_KEY` — a second fix-generation option `getFixGenerator()` falls back to if `AICREDITS_API_KEY`
  is ever unset. Unconfigured; not needed while AICredits works.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_AGENCY` —
  unrelated to `AGENT_MODE` entirely. `POST /billing/checkout` and `POST /stripe/webhook` are real, working
  code paths already, just inert without these. Wire up only once there's a paying prospect.

## The one rule that never changes

The agent halts at "reach checkout" and never submits payment — live or stub, local or cloud, this is
enforced in the checkpoint rubric (`reached_checkout` is the last checkpoint; there is no "complete
purchase" checkpoint at all) and separately in a forbidden-action-text filter checked before every act, in
both `runAgentAttempt.ts` and `runStagehandAttempt.ts`. Don't add a checkout-completing checkpoint. No
stored third-party credentials beyond user-supplied test accounts, encrypted and scoped. Respect
`robots.txt` and rate-limit per domain, per the original spec's hard safety rule.

## What's genuinely done and needs nothing further

All 12 screens, real Supabase auth/RLS/Realtime, run cancellation, real fix generation (live via AICredits,
templated fallback), the recurring scan job with real score-drop alerts, server-side free-tier/plan
enforcement at run creation, Billing with a real (key-gated) Stripe checkout path, Account settings with a
real delete-account flow, Agency client workspaces with real white-labeled report links (RLS-enforced, not
app-logic-enforced), a fully real `BROWSER_PROVIDER=local` live agent loop with real video and
real incremental streaming, and a second `AGENT_LLM_PROVIDER=gemini` reasoning client wired behind the same
interface (built and structurally verified, but never executed against a real key — see "What's verified vs.
what isn't" above), all built and verified against real data end-to-end. The only thing left is
deciding when to flip `AGENT_MODE=live` and spend the (now known, small) real money to try it.
