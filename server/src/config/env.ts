import "dotenv/config";
import { z } from "zod";

const EnvSchema = z
  .object({
    PORT: z.coerce.number().default(8787),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Publishable/anon key — same one the frontend ships, safe to be here.
    // Used for the public share page so row visibility is actually enforced
    // by RLS (the anon role), not just an app-level .eq('is_public', true)
    // filter that a future bug could drop.
    SUPABASE_ANON_KEY: z.string().min(1),

    // Where the marketing/app frontend lives — only used to build the
    // "Run yours — free" CTA link on the server-rendered public share page.
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),

    REDIS_URL: z.string().default("redis://localhost:6379"),

    // 'stub' (default) fakes attempt outcomes so the API/queue/worker/DB
    // pipeline can be exercised without spending real Gemini/browser cost —
    // see src/agent/stubRunAgentAttempt.ts. Switch to 'live' only once the
    // Day-1 gate has passed and the fields below are filled in.
    AGENT_MODE: z.enum(["stub", "live"]).default("stub"),

    GEMINI_API_KEY: z.string().optional(),
    // The dedicated computer-use model, used ONLY by the coordinate-based
    // steel/browserbase path (GeminiComputerUseDriver) — it emits click
    // coordinates via Gemini's computer-use tool. NOT the model used when
    // AGENT_LLM_PROVIDER=gemini on the local Stagehand path; that needs a
    // general vision+reasoning model, which is GEMINI_AGENT_MODEL below.
    GEMINI_COMPUTER_USE_MODEL: z.string().optional(),
    // Gemini's reasoning model for the local Stagehand live path — the
    // direct counterpart to AICREDITS_AGENT_MODEL, and deliberately a
    // separate var from GEMINI_COMPUTER_USE_MODEL above (different model
    // class, different job, different code path). Verify the exact current
    // id at ai.google.dev before the first real run.
    GEMINI_AGENT_MODEL: z.string().default("gemini-2.5-pro"),

    // Which LLM provides the *reasoning* for the local live agent loop.
    // Mirrors the FixGenerator provider-selection pattern. Defaults to
    // 'aicredits' — the path actually proven end to end — so nothing
    // changes until this is deliberately switched. See
    // agent/stagehand/index.ts for selection + fail-fast behaviour.
    // Orthogonal to BROWSER_PROVIDER: this picks the brain, that picks the
    // browser. Only consulted when BROWSER_PROVIDER=local, since the
    // steel/browserbase path uses GeminiComputerUseDriver by definition.
    AGENT_LLM_PROVIDER: z.enum(["aicredits", "gemini"]).default("aicredits"),

    // Which BrowserProvider the live path uses. 'local' launches a real
    // Chromium on this machine via Stagehand (see agent/runStagehandAttempt.ts)
    // — no Steel/Browserbase credential or cloud cost required, meant for
    // the developer testing live mode from their own machine. 'steel'/
    // 'browserbase' keep the original CDP-remote-session path (runAgentAttempt.ts)
    // for when a real computer-use model + hosted browser are funded.
    BROWSER_PROVIDER: z.enum(["local", "steel", "browserbase"]).default("local"),
    LOCAL_CHROME_PATH: z.string().optional(),

    STEEL_API_URL: z.string().url().default("http://localhost:3000"),
    STEEL_API_KEY: z.string().optional(),

    BROWSERBASE_API_KEY: z.string().optional(),
    BROWSERBASE_PROJECT_ID: z.string().optional(),

    VIDEO_STORAGE_BUCKET: z.string().default("run-videos"),

    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().default("AgentProbe <alerts@agentprobe.dev>"),

    // Live fix generation (cheap text model, not the agent's browser driver).
    // Fully optional in both modes — DeepSeekFixGenerator falls back to the
    // templated generator itself when this is absent, so nothing gates on
    // it at startup. Model is a separate env (not hardcoded) so pinning the
    // intended "DeepSeek V4 Flash" (per project notes) once it's confirmed
    // available is a config change, not a code change.
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

    // AICredits.in — INR-billed OpenAI-compatible gateway. No dedicated
    // computer-use/action-grounding model in their catalog, so it's never
    // used to output raw click coordinates directly (that's still
    // GeminiComputerUseDriver's job, reserved for when real Gemini
    // computer-use is funded). It IS used two ways: (1) FixGenerator's text
    // reasoning (AICreditsFixGenerator), and (2) as the reasoning layer
    // behind a real BROWSER_PROVIDER=local live run — Stagehand does the
    // actual DOM grounding/execution (its own act()/observe()), AICredits
    // only ever decides *what* to do next in natural language. See
    // agent/runStagehandAttempt.ts and agent/stagehand/AICreditsLLMClient.ts.
    AICREDITS_API_KEY: z.string().optional(),
    AICREDITS_BASE_URL: z.string().url().default("https://api.aicredits.in/v1"),
    AICREDITS_MODEL: z.string().default("google/gemini-3.1-flash-lite"),
    // Separate from AICREDITS_MODEL (fix generation) — the agent loop needs
    // real vision+reasoning quality, not the cheapest text model. Confirmed
    // against AICredits' real catalog: google/gemini-2.5-pro exists and
    // handles vision. NOTE: AICredits' Gemini route silently returns an
    // empty completion for OpenAI's response_format:"json_schema" (real
    // tokens spent, no output) — AICreditsLLMClient uses "json_object" with
    // the schema described in-prompt instead; don't revert that without
    // re-testing against a real call first.
    AICREDITS_AGENT_MODEL: z.string().default("google/gemini-2.5-pro"),

    // Stripe — fully optional in both modes (payments are orthogonal to
    // AGENT_MODE). Absence means /billing/checkout and /stripe/webhook
    // answer honestly that payments aren't wired up yet, rather than
    // crashing or pretending to succeed.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_PRO: z.string().optional(),
    STRIPE_PRICE_ID_AGENCY: z.string().optional(),

    // How often the worker checks schedules for due scans. Frequent is
    // cheap (it's just a DB query when nothing's due) and keeps dev/test
    // feedback fast; a real deployment could safely widen this.
    SCHEDULER_TICK_MS: z.coerce.number().default(60_000),

    GATE_TARGET_URL: z.string().url().optional(),
    GATE_TARGET_GOAL: z.string().optional(),
  })
  .refine(
    (env) =>
      env.AGENT_MODE !== "live" ||
      env.BROWSER_PROVIDER !== "local" ||
      (env.AGENT_LLM_PROVIDER === "gemini" ? Boolean(env.GEMINI_API_KEY) : Boolean(env.AICREDITS_API_KEY)),
    {
      message:
        "AGENT_MODE=live with BROWSER_PROVIDER=local requires the API key for the selected AGENT_LLM_PROVIDER: " +
        "AICREDITS_API_KEY for 'aicredits' (default), or GEMINI_API_KEY for 'gemini'",
      path: ["AGENT_MODE"],
    },
  )
  .refine(
    (env) => env.AGENT_MODE !== "live" || env.BROWSER_PROVIDER === "local" || Boolean(env.GEMINI_API_KEY && env.GEMINI_COMPUTER_USE_MODEL),
    {
      message: "AGENT_MODE=live with BROWSER_PROVIDER=steel/browserbase requires GEMINI_API_KEY and GEMINI_COMPUTER_USE_MODEL (the dedicated computer-use path)",
      path: ["AGENT_MODE"],
    },
  )
  .refine(
    (env) =>
      env.AGENT_MODE !== "live" ||
      env.BROWSER_PROVIDER === "local" ||
      Boolean(env.STEEL_API_KEY) ||
      Boolean(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID),
    {
      message:
        "AGENT_MODE=live with BROWSER_PROVIDER=steel/browserbase requires that provider's credential: STEEL_API_KEY, or both BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID",
      path: ["AGENT_MODE"],
    },
  );

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazily validated so importing this module never throws at compile/tsc time —
 * only the first call at runtime requires real credentials to be present.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  cached = parsed.data;
  return cached;
}
