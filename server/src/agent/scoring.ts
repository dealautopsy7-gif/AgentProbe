import { CHECKPOINT_DEFINITIONS, type CheckpointResult } from "./checkpoints.js";

export type ScoreBand = "red" | "amber" | "green";

export interface ScoreResult {
  score: number;
  band: ScoreBand;
}

const TOTAL_WEIGHT = CHECKPOINT_DEFINITIONS.reduce((sum, cp) => sum + cp.weight, 0);

/**
 * Per-attempt weighted checkpoint score, 0-1. Reaching checkout is weighted
 * highest (4 of the 13 total weight points) since that's the funnel step
 * that actually predicts whether an agent can buy — a store that nails the
 * listing/PDP but blocks at checkout should still score low.
 */
function attemptCheckpointScore(results: CheckpointResult[]): number {
  const earned = results.reduce((sum, r) => {
    const def = CHECKPOINT_DEFINITIONS.find((d) => d.name === r.name);
    return sum + (r.passed && def ? def.weight : 0);
  }, 0);
  return earned / TOTAL_WEIGHT;
}

/**
 * Aggregate 0-100 Agent-Readiness score across all attempts in a run.
 * Blends the average per-attempt checkpoint score with the raw completion
 * rate (successes / attempts) so a store that inconsistently succeeds
 * (nondeterminism is expected — see spec) doesn't score as well as one that
 * reliably clears every checkpoint every time.
 */
export function computeScore(attemptResults: CheckpointResult[][]): ScoreResult {
  if (attemptResults.length === 0) return { score: 0, band: "red" };

  const perAttemptScores = attemptResults.map(attemptCheckpointScore);
  const avgCheckpointScore = perAttemptScores.reduce((a, b) => a + b, 0) / perAttemptScores.length;

  const completions = attemptResults.filter((r) =>
    r.find((c) => c.name === "reached_checkout")?.passed,
  ).length;
  const completionRate = completions / attemptResults.length;

  const blended = 0.6 * avgCheckpointScore + 0.4 * completionRate;
  const score = Math.round(blended * 100);

  const band: ScoreBand = score >= 80 ? "green" : score >= 50 ? "amber" : "red";
  return { score, band };
}
