import type { getSupabase } from "../lib/supabase.js";
import { getFixGenerator } from "./fixGenerators/index.js";

/**
 * Generates the run's fix list via the configured FixGenerator (templated
 * by default, DeepSeek-backed once DEEPSEEK_API_KEY exists — see
 * fixGenerators/index.ts) and writes it to the `fixes` table. Idempotent-ish:
 * called once per run completion; if it somehow ran twice you'd get
 * duplicate rows (no unique constraint on run_id+problem), an acceptable
 * gap since runWorker.ts only ever calls it once, right after marking the
 * run done.
 */
export async function generateFixes(supabase: ReturnType<typeof getSupabase>, runId: string): Promise<void> {
  const [{ data: run }, { data: attempts, error }] = await Promise.all([
    supabase.from("runs").select("goal").eq("id", runId).maybeSingle(),
    supabase.from("attempts").select("stuck_reason").eq("run_id", runId).not("stuck_reason", "is", null),
  ]);
  if (error || !attempts || attempts.length === 0) return;

  const stuckReasons = attempts.map((a) => a.stuck_reason ?? "").filter(Boolean);
  if (stuckReasons.length === 0) return;

  const fixes = await getFixGenerator().generate({ goal: run?.goal ?? "", stuckReasons });
  if (fixes.length === 0) return;

  await supabase.from("fixes").insert(
    fixes.map((f) => ({
      run_id: runId,
      severity: f.severity,
      problem: f.problem,
      likely_cause: f.likelyCause,
      suggested_fix: f.suggestedFix,
    })),
  );
}
