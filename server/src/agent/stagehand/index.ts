import { getEnv } from "../../config/env.js";
import type { AgentLLMClient } from "./AgentLLMClient.js";
import { AICreditsLLMClient } from "./AICreditsLLMClient.js";
import { GeminiDirectLLMClient } from "./GeminiDirectLLMClient.js";

export type { AgentLLMClient, AgentLLMUsage, AgentLLMProviderName } from "./AgentLLMClient.js";

/**
 * Picks the reasoning client for the local live agent loop, mirroring
 * fixGenerators/index.ts's provider-selection style.
 *
 * Deliberately NOT a silent fallback chain like the fix generators'. A fix
 * list falling back to templated output is a graceful degradation nobody
 * needs to know about; silently swapping the *agent's brain* to a
 * different vendor mid-run would invalidate the cost/quality comparison
 * this switch exists to enable, and would be genuinely confusing. So the
 * requested provider is either available or this throws — loudly, before
 * a browser is ever launched or a single token is spent.
 *
 * `AGENT_LLM_PROVIDER` defaults to 'aicredits' (the proven path) so
 * nothing changes for existing testing until it's deliberately switched.
 */
export function getAgentLLMClient(overrideProvider?: string): AgentLLMClient {
  const env = getEnv();
  const provider = overrideProvider ?? env.AGENT_LLM_PROVIDER;

  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new Error(
        "AGENT_LLM_PROVIDER=gemini requires GEMINI_API_KEY in server/.env. " +
          "Set it (see LIVE-READINESS.md, 'To test with direct Gemini API'), or set AGENT_LLM_PROVIDER=aicredits to use the already-working provider.",
      );
    }
    return new GeminiDirectLLMClient(env.GEMINI_AGENT_MODEL, env.GEMINI_API_KEY);
  }

  if (provider === "aicredits") {
    if (!env.AICREDITS_API_KEY) {
      throw new Error(
        "AGENT_LLM_PROVIDER=aicredits requires AICREDITS_API_KEY in server/.env. " +
          "Set it, or set AGENT_LLM_PROVIDER=gemini if you have a funded Gemini key instead.",
      );
    }
    return new AICreditsLLMClient(env.AICREDITS_AGENT_MODEL, env.AICREDITS_API_KEY, env.AICREDITS_BASE_URL);
  }

  throw new Error(`Unknown AGENT_LLM_PROVIDER "${provider}" — expected "aicredits" or "gemini".`);
}
