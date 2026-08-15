import { getEnv } from "../../config/env.js";
import type { FixGenerator } from "../FixGenerator.js";
import { TemplateFixGenerator } from "./TemplateFixGenerator.js";
import { DeepSeekFixGenerator } from "./DeepSeekFixGenerator.js";
import { AICreditsFixGenerator } from "./AICreditsFixGenerator.js";

/**
 * Gated on API key presence alone, not AGENT_MODE — fix generation is a
 * cheap text call unrelated to the agent's browser-automation cost, so
 * there's no reason to tie it to the stub/live agent switch. AICredits is
 * preferred over DeepSeek when both are configured, since it's the one
 * actually being validated right now; DeepSeek stays as a second option in
 * case AICredits is ever disabled. Absent both keys, this always resolves
 * to the templated generator, which both live implementations also fall
 * back to on any call failure.
 */
export function getFixGenerator(): FixGenerator {
  const env = getEnv();
  if (env.AICREDITS_API_KEY) {
    return new AICreditsFixGenerator(env.AICREDITS_API_KEY, env.AICREDITS_BASE_URL, env.AICREDITS_MODEL);
  }
  if (env.DEEPSEEK_API_KEY) {
    return new DeepSeekFixGenerator(env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL);
  }
  return new TemplateFixGenerator();
}
