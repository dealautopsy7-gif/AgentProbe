import type { FixGenerator, FixGeneratorInput, FixInput } from "../FixGenerator.js";
import { TemplateFixGenerator } from "./TemplateFixGenerator.js";
import { FIX_SYSTEM_PROMPT, buildFixUserMessage, isFixInput } from "./shared.js";

interface OpenAICompatibleChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * AICredits.in — an INR-billed OpenAI-compatible gateway offering Gemini
 * chat/vision models (confirmed via their model catalog: no
 * computer-use-class model, so this is deliberately scoped to text
 * reasoning only — never wire this in as an AgentDriver). Same
 * fetch-only, no-SDK style as DeepSeekFixGenerator; only the base URL and
 * model are different, since it's a drop-in OpenAI-compatible surface.
 *
 * Falls back to the templated generator on any failure — a bad response
 * from an unfamiliar gateway must never break a run's fix list.
 */
export class AICreditsFixGenerator implements FixGenerator {
  readonly name = "aicredits";
  private readonly fallback = new TemplateFixGenerator();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate(input: FixGeneratorInput): Promise<FixInput[]> {
    if (input.stuckReasons.length === 0) return [];
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: FIX_SYSTEM_PROMPT },
            { role: "user", content: buildFixUserMessage(input.goal, input.stuckReasons) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AICredits API returned ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as OpenAICompatibleChatResponse;

      if (data.usage) {
        console.log(
          `[AICreditsFixGenerator] usage: prompt_tokens=${data.usage.prompt_tokens ?? "?"} completion_tokens=${data.usage.completion_tokens ?? "?"} total_tokens=${data.usage.total_tokens ?? "?"} (model=${this.model})`,
        );
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("AICredits response missing message content");

      const parsed = JSON.parse(content);
      const fixes = Array.isArray(parsed?.fixes) ? parsed.fixes.filter(isFixInput) : [];
      if (fixes.length === 0) return this.fallback.generate(input);
      return fixes;
    } catch (err) {
      console.error("[AICreditsFixGenerator] falling back to templated fixes:", err instanceof Error ? err.message : err);
      return this.fallback.generate(input);
    }
  }
}
