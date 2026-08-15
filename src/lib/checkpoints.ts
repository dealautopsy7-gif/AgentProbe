import type { CheckpointName } from "./api";

/** Mirrors server/src/agent/checkpoints.ts CHECKPOINT_DEFINITIONS (display labels only). */
export const CHECKPOINT_RAIL: { name: CheckpointName; railLabel: string; rowLabel: string }[] = [
  { name: "reached_listing", railLabel: "FIND PRODUCT", rowLabel: "Find product" },
  { name: "reached_pdp", railLabel: "PRODUCT PAGE", rowLabel: "Product page" },
  { name: "price_legible", railLabel: "READ PRICE", rowLabel: "Read price" },
  { name: "stock_determinable", railLabel: "STOCK", rowLabel: "Determine stock" },
  { name: "added_to_cart", railLabel: "ADD TO CART", rowLabel: "Add to cart" },
  { name: "reached_checkout", railLabel: "CHECKOUT", rowLabel: "Reach checkout" },
];

export type RailStatus = "pending" | "pass" | "fail";

/**
 * Turns a partial/complete pass|null map into rail statuses. The first
 * checkpoint that's false right after the last true one is marked "fail"
 * once the attempt has actually concluded (outcome no longer null) — while
 * still in progress, unreached checkpoints just read as pending, not failed.
 */
export function deriveRailStatuses(
  passedByName: Partial<Record<CheckpointName, boolean>>,
  attemptConcluded: boolean,
): Record<CheckpointName, RailStatus> {
  const result = {} as Record<CheckpointName, RailStatus>;
  let sawFalseAfterTrue = false;
  let sawAnyTrue = false;

  for (const { name } of CHECKPOINT_RAIL) {
    const passed = passedByName[name];
    if (passed === true) {
      result[name] = "pass";
      sawAnyTrue = true;
    } else if (passed === false && attemptConcluded && sawAnyTrue && !sawFalseAfterTrue) {
      result[name] = "fail";
      sawFalseAfterTrue = true;
    } else {
      result[name] = "pending";
    }
  }
  return result;
}
