import type { AgentStepHistoryEntry } from "./AgentDriver.js";

/**
 * The ecommerce checkpoint rubric (spec's MVP niche). Order matters — it's
 * the funnel order, and "reached_checkout" is also the hard stop: the loop
 * in runAgentAttempt.ts must never proceed past it, at any weight, ever.
 */
export const CHECKPOINT_DEFINITIONS = [
  { name: "reached_listing", label: "Reached product listing", weight: 1 },
  { name: "reached_pdp", label: "Reached product detail page", weight: 1 },
  { name: "price_legible", label: "Price was legible", weight: 2 },
  { name: "stock_determinable", label: "Stock/availability was determinable", weight: 2 },
  { name: "added_to_cart", label: "Add-to-cart succeeded", weight: 3 },
  { name: "reached_checkout", label: "Checkout page reached", weight: 4 },
] as const;

export type CheckpointName = (typeof CHECKPOINT_DEFINITIONS)[number]["name"];

export interface CheckpointResult {
  name: CheckpointName;
  passed: boolean;
  reason?: string;
}

/**
 * Evaluates one attempt's checkpoints from its step history.
 *
 * TODO: this is a placeholder pass/fail heuristic (checks whether an action
 * targeting each checkpoint's concern shows up in history). The real
 * implementation should use the AgentDriver's own structured signals
 * (e.g. an explicit "checkpoint reached" observation, or a dedicated
 * verification pass per checkpoint) rather than string-matching actions —
 * wire that up once GeminiComputerUseDriver is real and its response shape
 * is known.
 */
export function evaluateCheckpoints(history: AgentStepHistoryEntry[]): CheckpointResult[] {
  const joined = history.map((h) => `${h.action.type} ${h.action.target ?? ""} ${h.action.reasoning}`).join(" | ").toLowerCase();

  const heuristics: Record<CheckpointName, RegExp> = {
    reached_listing: /listing|category|collection|search results/,
    reached_pdp: /product page|product detail|pdp/,
    price_legible: /price/,
    stock_determinable: /stock|availability|in stock|out of stock/,
    added_to_cart: /add(ed)? to cart/,
    reached_checkout: /checkout/,
  };

  return CHECKPOINT_DEFINITIONS.map(({ name }) => ({
    name,
    passed: heuristics[name].test(joined),
  }));
}
