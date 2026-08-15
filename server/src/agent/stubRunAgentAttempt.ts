import type { AgentActionType } from "./AgentDriver.js";

export type StubOutcome = "success" | "fail-cp04" | "fail-cp03";

export interface StubStep {
  stepNumber: number;
  type: AgentActionType;
  reasoning: string;
}

/**
 * Fake but structurally real steps — written so the real evaluateCheckpoints()
 * heuristics (not hand-built checkpoint arrays) are what actually determine
 * pass/fail, so this stub genuinely tests that code path, not just the
 * queue/DB plumbing around it.
 *
 * Wording is deliberately careful about which keywords appear in *failure*
 * lines (e.g. avoiding the literal phrase "add to cart" in a stall
 * description) because evaluateCheckpoints is a naive substring/regex
 * heuristic today — see the TODO in checkpoints.ts. This keeps stub-mode
 * data internally consistent (a failed attempt doesn't show a later
 * checkpoint as "passed") without papering over that heuristic's real
 * limitation, which still needs fixing before AGENT_MODE=live.
 */
function scriptFor(outcome: StubOutcome): { type: AgentActionType; reasoning: string }[] {
  if (outcome === "success") {
    return [
      { type: "navigate", reasoning: "Opened the backpacks listing page" },
      { type: "click", reasoning: "Opened the product detail page for Trail 28 Backpack" },
      { type: "wait", reasoning: "Read the price: $128.00" },
      { type: "wait", reasoning: "Checked stock: in stock, 12 available" },
      { type: "click", reasoning: "Added to cart successfully" },
      { type: "finish", reasoning: "Reached checkout — stopping before payment as required" },
    ];
  }
  if (outcome === "fail-cp03") {
    return [
      { type: "navigate", reasoning: "Opened the backpacks listing page" },
      { type: "click", reasoning: "Opened the product detail page for Trail 28 Backpack" },
      { type: "wait", reasoning: "Read the price: $128.00" },
      { type: "give_up", reasoning: "There is no way to tell whether this item can be purchased right now" },
    ];
  }
  return [
    { type: "navigate", reasoning: "Opened the backpacks listing page" },
    { type: "click", reasoning: "Opened the product detail page for Trail 28 Backpack" },
    { type: "wait", reasoning: "Read the price: $128.00" },
    { type: "wait", reasoning: "Checked stock: in stock, 12 available" },
    { type: "give_up", reasoning: "A cookie consent banner covers the purchase button with no way to dismiss it, so I cannot proceed" },
  ];
}

export function outcomeFor(attemptIndex: number, totalAttempts: number): StubOutcome {
  if (totalAttempts === 1) return "fail-cp04";
  const pattern: StubOutcome[] = ["success", "fail-cp04", "fail-cp04", "success", "fail-cp03"];
  return pattern[attemptIndex % pattern.length]!;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yields one step at a time with a realistic "thinking" delay before each,
 * so a caller (runWorker.ts) can write each step to the DB as it lands
 * instead of batching the whole attempt at once — that incremental write is
 * what Screen 4 (Live Run) actually streams via Supabase Realtime.
 */
export async function* streamStubSteps(attemptIndex: number, totalAttempts: number): AsyncGenerator<StubStep> {
  const outcome = outcomeFor(attemptIndex, totalAttempts);
  const script = scriptFor(outcome);

  for (let i = 0; i < script.length; i++) {
    await sleep(500 + Math.random() * 500);
    yield { stepNumber: i + 1, type: script[i]!.type, reasoning: script[i]!.reasoning };
  }
}

/** Rough token usage per step, for illustrative cost tracking only (stub mode spends nothing real). */
export function estimateStepUsage() {
  return {
    inputTokens: 90 + Math.floor(Math.random() * 40),
    outputTokens: 20 + Math.floor(Math.random() * 15),
  };
}
