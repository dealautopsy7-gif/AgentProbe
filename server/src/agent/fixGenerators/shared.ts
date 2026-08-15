import type { FixInput } from "../FixGenerator.js";

const SEVERITIES = new Set(["critical", "high", "medium"]);

/**
 * Shared by every OpenAI-compatible FixGenerator implementation (DeepSeek,
 * AICredits, any future one) so the prompt and response-shape validation
 * can't drift apart between them.
 */
export function isFixInput(v: unknown): v is FixInput {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.severity === "string" &&
    SEVERITIES.has(f.severity) &&
    typeof f.problem === "string" &&
    f.problem.length > 0 &&
    typeof f.likelyCause === "string" &&
    typeof f.suggestedFix === "string" &&
    f.suggestedFix.length > 0
  );
}

export const FIX_SYSTEM_PROMPT = `You audit why an AI shopping agent failed to complete a purchase on a website, given its own stuck-reason notes. For each DISTINCT underlying problem (do not repeat near-duplicates), respond with a JSON object: {"fixes": [{"severity": "critical"|"high"|"medium", "problem": "short plain-English headline", "likelyCause": "one sentence on why this likely happened", "suggestedFix": "a concrete HTML/CSS/structured-data snippet or short instruction a developer could apply"}]}. Never invent a problem that isn't supported by the given stuck reasons. If nothing is clear enough to fix, return {"fixes": []}.`;

export function buildFixUserMessage(goal: string, stuckReasons: string[]): string {
  return `Goal: ${goal}\n\nStuck reasons from failed/blocked attempts:\n${stuckReasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}
