import type { FixGenerator, FixGeneratorInput, FixInput } from "../FixGenerator.js";
import { TemplateFixGenerator } from "./TemplateFixGenerator.js";
import { FIX_SYSTEM_PROMPT, buildFixUserMessage, isFixInput } from "./shared.js";

/**
 * Real implementation — calls DeepSeek's OpenAI-compatible chat completions
 * endpoint (raw fetch, no SDK dependency needed for a single JSON-mode
 * call). Falls back to the templated generator, not an empty result or a
 * thrown error, whenever DEEPSEEK_API_KEY is absent or the call fails for
 * any reason — a run must always get SOME fix list from its own data
 * rather than none because a text-model call hiccuped.
 */
export class DeepSeekFixGenerator implements FixGenerator {
  readonly name = "deepseek";
  private readonly fallback = new TemplateFixGenerator();

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generate(input: FixGeneratorInput): Promise<FixInput[]> {
    if (input.stuckReasons.length === 0) return [];
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
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

      if (!res.ok) throw new Error(`DeepSeek API returned ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("DeepSeek response missing message content");

      const parsed = JSON.parse(content);
      const fixes = Array.isArray(parsed?.fixes) ? parsed.fixes.filter(isFixInput) : [];
      if (fixes.length === 0) return this.fallback.generate(input);
      return fixes;
    } catch (err) {
      console.error("[DeepSeekFixGenerator] falling back to templated fixes:", err instanceof Error ? err.message : err);
      return this.fallback.generate(input);
    }
  }
}
