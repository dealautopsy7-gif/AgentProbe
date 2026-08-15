import type { LLMClient } from "@browserbasehq/stagehand";

/**
 * Usage/cost accounting accumulated across every call made through one
 * client instance — which, for the local live path, means BOTH the agent
 * loop's own "what's the next step" decisions AND Stagehand's internal
 * act()/observe() grounding calls, since both go through the same
 * stagehand.llmClient. That's roughly 2 calls per step, so per-client
 * totals are the only honest way to report what an attempt actually cost.
 */
export interface AgentLLMUsage {
  /** Which provider produced these numbers — surfaced in gate output so a cost figure is never ambiguous. */
  provider: AgentLLMProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Real billed cost, in INR, when the provider self-reports it per call
   * (AICredits does — see `usage.cost` in its response). `null` when the
   * provider does NOT report cost and it therefore has to be estimated
   * from token counts by the caller (Gemini's API doesn't report cost).
   *
   * null is meaningfully different from 0 here: 0 would claim "this was
   * free", null says "this provider can't tell us — estimate it". Callers
   * must not coalesce it to 0.
   */
  costInr: number | null;
}

export type AgentLLMProviderName = "aicredits" | "gemini";

/**
 * The shared contract `runStagehandAttempt.ts` talks to. Both concrete
 * clients extend Stagehand's own abstract `LLMClient` (that's the interface
 * Stagehand itself calls into — we don't need to invent a second one) and
 * additionally expose usage accounting on top, which Stagehand has no
 * concept of.
 */
export interface AgentLLMClient extends LLMClient {
  getUsage(): AgentLLMUsage;
}
