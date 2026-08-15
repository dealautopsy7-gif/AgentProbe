/**
 * Day-1 go/no-go gate (spec: "do not skip this. The entire business model
 * depends on this number.").
 *
 * Runs ONE full agent attempt against GATE_TARGET_URL/GATE_TARGET_GOAL and
 * logs the exact cost. Branches on BROWSER_PROVIDER:
 *  - 'local' (default): runStagehandAttempt.ts — real local Chromium,
 *    Stagehand grounding, AICredits reasoning. Cost is AICredits' own
 *    self-reported real per-call INR figure (see AICreditsLLMClient's
 *    totalCostInr), not an estimate from a hardcoded $/token table.
 *  - 'steel'/'browserbase': the original runAgentAttempt.ts +
 *    GeminiComputerUseDriver path, reserved for when real Gemini
 *    computer-use is funded (see LIVE-READINESS.md) — cost there still
 *    needs the hardcoded $/token constants below, since Gemini's API
 *    doesn't report cost back the way AICredits does.
 *
 * Run with: npm run gate
 * (temporarily set AGENT_MODE=live for this one invocation if it's 'stub'
 * in .env — this script calls the attempt runner directly, so AGENT_MODE
 * itself doesn't gate it, but leaving stub as the persisted default is the
 * point: `AGENT_MODE=live npm run gate` rather than editing .env.)
 */
import { getEnv } from "../src/config/env.js";
import { runAgentAttempt } from "../src/agent/runAgentAttempt.js";
import { runStagehandAttempt } from "../src/agent/runStagehandAttempt.js";
import { GeminiComputerUseDriver } from "../src/agent/drivers/GeminiComputerUseDriver.js";
import { SteelBrowserProvider } from "../src/agent/providers/SteelBrowserProvider.js";

const COST_CEILING_USD = 0.4;
// Informal, not authoritative — update if INR/USD moves meaningfully before
// this matters again. Only used to compare AICredits' real INR cost against
// the same USD ceiling the original spec set.
const INR_PER_USD = 87;

// gemini-2.5-computer-use-preview-10-2025, prompts <=200k tokens, confirmed
// against https://ai.google.dev/gemini-api/docs/pricing directly (not just
// a secondary source) on 2026-08-10: $1.25/1M input, $10.00/1M output.
// Only used for the steel/browserbase + GeminiComputerUseDriver path —
// AICredits reports its own real cost, no estimate needed there.
const PRICE_PER_1K_INPUT_TOKENS_USD = 1.25 / 1000;
const PRICE_PER_1K_OUTPUT_TOKENS_USD = 10.0 / 1000;

// Used ONLY to estimate cost for AGENT_LLM_PROVIDER=gemini on the local
// path, since Gemini's API doesn't report billed cost. Set from
// gemini-2.5-pro's published rates (<=200k-token prompts) as of 2026-08-10
// — NOT re-verified since, and the default agent model may change. Check
// https://ai.google.dev/gemini-api/docs/pricing before trusting the
// estimate. Note 2.5-series "thinking" tokens bill as output and ARE
// counted (see GeminiDirectLLMClient's usage accounting).
const GEMINI_AGENT_PRICE_PER_1K_INPUT_USD = 1.25 / 1000;
const GEMINI_AGENT_PRICE_PER_1K_OUTPUT_USD = 10.0 / 1000;
// Steel.dev self-hosted via docker-compose — no per-minute vendor charge,
// unlike Steel Cloud or Browserbase. Real cost is whatever compute you're
// already paying for to run the container, not captured here.
const PRICE_PER_BROWSER_MINUTE_USD = 0;

async function runLocalGate(url: string, goal: string, llmProvider: string) {
  const startedAt = Date.now();
  const result = await runStagehandAttempt({ url, goal, recordVideo: false, llmProvider });
  const elapsedMinutes = (Date.now() - startedAt) / 60_000;
  const { usage } = result;

  console.log("--- Steps taken ---");
  for (const step of result.steps) {
    console.log(`${step.stepNumber}. [${step.action.type}] ${step.action.target ?? ""} — ${step.action.reasoning}`);
  }
  if (result.stuckReason) console.log(`Stuck reason: ${result.stuckReason}`);
  console.log();

  console.log(`--- Day-1 gate result (BROWSER_PROVIDER=local, AGENT_LLM_PROVIDER=${usage.provider}) ---`);
  console.log(`Model:            ${usage.model}`);
  console.log(`Outcome:          ${result.outcome}`);
  console.log(`Steps taken:      ${result.steps.length}`);
  console.log(`Input tokens:     ${usage.inputTokens}`);
  console.log(`Output tokens:    ${usage.outputTokens}`);
  console.log(`Wall time:        ${elapsedMinutes.toFixed(2)} min`);

  let totalCostUsd: number;
  if (usage.costInr !== null) {
    // AICredits self-reports real billed cost per call — no estimation.
    totalCostUsd = usage.costInr / INR_PER_USD;
    console.log(`REAL COST (INR):  ₹${usage.costInr.toFixed(4)}  [provider-reported, not estimated]`);
    console.log(`REAL COST (USD):  $${totalCostUsd.toFixed(4)} (at ₹${INR_PER_USD}/$, informal)`);
  } else {
    // Gemini doesn't report cost — estimate from tokens. Flagged as an
    // estimate everywhere so it's never mistaken for a billed figure.
    totalCostUsd =
      (usage.inputTokens / 1000) * GEMINI_AGENT_PRICE_PER_1K_INPUT_USD +
      (usage.outputTokens / 1000) * GEMINI_AGENT_PRICE_PER_1K_OUTPUT_USD;
    console.log(`EST. COST (USD):  $${totalCostUsd.toFixed(4)}  [ESTIMATE from tokens — Gemini does not report billed cost]`);
    console.log(`EST. COST (INR):  ₹${(totalCostUsd * INR_PER_USD).toFixed(4)} (at ₹${INR_PER_USD}/$, informal)`);
    console.log(
      `\n  Estimate uses $${(GEMINI_AGENT_PRICE_PER_1K_INPUT_USD * 1000).toFixed(2)}/1M input, ` +
        `$${(GEMINI_AGENT_PRICE_PER_1K_OUTPUT_USD * 1000).toFixed(2)}/1M output.\n` +
        `  VERIFY these against https://ai.google.dev/gemini-api/docs/pricing for "${usage.model}" before\n` +
        `  trusting the number — they were set for gemini-2.5-pro and models/prices change.`,
    );
  }

  console.log(`Ceiling:          $${COST_CEILING_USD.toFixed(2)}`);
  console.log(
    "\nNote: each step here makes ~2 real model calls (this loop's own \"what's next\" decision, plus Stagehand's\ninternal grounding call for whatever instruction gets handed to act()) — both go through the same client\nand are both included above.",
  );

  return totalCostUsd;
}

async function runSteelGate(url: string, goal: string) {
  const startedAt = Date.now();
  const result = await runAgentAttempt({
    url,
    goal,
    browserProvider: new SteelBrowserProvider(),
    agentDriver: new GeminiComputerUseDriver(),
    recordVideo: true,
  });

  const elapsedMinutes = (Date.now() - startedAt) / 60_000;
  const tokenCost =
    (result.usage.inputTokens / 1000) * PRICE_PER_1K_INPUT_TOKENS_USD +
    (result.usage.outputTokens / 1000) * PRICE_PER_1K_OUTPUT_TOKENS_USD;
  const browserCost = elapsedMinutes * PRICE_PER_BROWSER_MINUTE_USD;
  const totalCost = tokenCost + browserCost;

  console.log("--- Day-1 gate result (BROWSER_PROVIDER=steel/browserbase, Gemini computer-use) ---");
  console.log(`Outcome:          ${result.outcome}`);
  console.log(`Steps taken:      ${result.steps.length}`);
  console.log(`Input tokens:     ${result.usage.inputTokens}`);
  console.log(`Output tokens:    ${result.usage.outputTokens}`);
  console.log(`Browser minutes:  ${elapsedMinutes.toFixed(2)}`);
  console.log(`Token cost:       $${tokenCost.toFixed(4)}`);
  console.log(`Browser cost:     $${browserCost.toFixed(4)}`);
  console.log(`TOTAL COST:       $${totalCost.toFixed(4)}`);
  console.log(`Ceiling:          $${COST_CEILING_USD.toFixed(2)}`);

  if (PRICE_PER_1K_INPUT_TOKENS_USD === 0 && PRICE_PER_1K_OUTPUT_TOKENS_USD === 0) {
    console.warn("\nWARNING: token pricing constants at the top of this script are still 0 — fill in real $/token rates before trusting TOTAL COST.");
  }
  if (PRICE_PER_BROWSER_MINUTE_USD === 0) {
    console.log("\n(Browser cost is $0 because Steel is self-hosted here, not a per-minute vendor charge — see comment above.)");
  }

  return totalCost;
}

/** Supports `npm run gate -- --provider=gemini`; falls back to AGENT_LLM_PROVIDER from .env. */
function parseProviderFlag(): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--provider"));
  if (!arg) return undefined;
  const value = arg.includes("=") ? arg.split("=")[1] : process.argv[process.argv.indexOf(arg) + 1];
  if (!value) {
    console.error("--provider needs a value: --provider=aicredits or --provider=gemini");
    process.exit(1);
  }
  if (value !== "aicredits" && value !== "gemini") {
    console.error(`Unknown --provider "${value}" — expected "aicredits" or "gemini".`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const env = getEnv();
  const url = env.GATE_TARGET_URL;
  const goal = env.GATE_TARGET_GOAL;

  if (!url || !goal) {
    console.error("Set GATE_TARGET_URL and GATE_TARGET_GOAL in .env before running the gate.");
    process.exit(1);
  }

  const llmProvider = parseProviderFlag() ?? env.AGENT_LLM_PROVIDER;

  console.log(`Day-1 gate: running one attempt against ${url}`);
  console.log(`BROWSER_PROVIDER=${env.BROWSER_PROVIDER}${env.BROWSER_PROVIDER === "local" ? `, AGENT_LLM_PROVIDER=${llmProvider}` : " (uses Gemini computer-use by definition)"}`);
  console.log(`Goal: ${goal}\n`);

  const totalCostUsd =
    env.BROWSER_PROVIDER === "local" ? await runLocalGate(url, goal, llmProvider) : await runSteelGate(url, goal);

  if (totalCostUsd > COST_CEILING_USD) {
    console.error("\nGATE: FAIL — cost exceeds the ceiling. Stop and redesign before building further (see spec).");
    process.exit(1);
  }

  console.log("\nGATE: PASS — proceed with the build.");
}

main().catch((err) => {
  console.error("\nDay-1 gate script errored:");
  console.error(err);
  process.exit(1);
});
