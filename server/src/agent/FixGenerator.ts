/**
 * Abstracts how a run's fix list gets written. TemplateFixGenerator (regex,
 * no LLM call) is the only implementation exercised while AGENT_MODE=stub;
 * DeepSeekFixGenerator is real but only activates once DEEPSEEK_API_KEY is
 * set — see fixGenerators/index.ts for the selection logic. Mirrors the
 * AgentDriver/BrowserProvider pattern so nothing calling this needs to
 * change when a real key shows up.
 */

export interface FixInput {
  severity: "critical" | "high" | "medium";
  problem: string;
  likelyCause: string;
  suggestedFix: string;
}

export interface FixGeneratorInput {
  goal: string;
  /** Non-null stuck_reason values across the run's failed/blocked attempts. */
  stuckReasons: string[];
}

export interface FixGenerator {
  readonly name: string;
  generate(input: FixGeneratorInput): Promise<FixInput[]>;
}
