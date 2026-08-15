import type { PlanTier } from "../types/db.js";

export interface PlanLimit {
  sites: number | null;
  runs: number | null;
  label: string;
  priceUsd: number;
}

/**
 * Shared between billing.ts (display) and runs.ts (enforcement) so the
 * numbers shown to a user are exactly the numbers enforced against them —
 * two copies of this table drifting apart would be a real bug, not a
 * cosmetic one. `runs: null` means no lifetime cap (Pro/Agency are capped
 * only by site count and by unlimited scheduled scans, per spec); Free's
 * `runs: 1` matches the "1 site · 1 test" copy already on Landing/Billing.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  free: { sites: 1, runs: 1, label: "Free", priceUsd: 0 },
  pro: { sites: 10, runs: null, label: "Pro", priceUsd: 79 },
  agency: { sites: null, runs: null, label: "Agency", priceUsd: 299 },
};
