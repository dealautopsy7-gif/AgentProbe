import { LLMClient, type ChatCompletionOptions, type CreateChatCompletionOptions, type LLMResponse } from "@browserbasehq/stagehand";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentLLMClient, AgentLLMUsage } from "./AgentLLMClient.js";

/**
 * Stagehand's LLMClient abstract class expects createChatCompletion() to
 * speak OpenAI's own chat-completions shapes (ChatMessage, LLMResponse with
 * choices[].message.tool_calls) — since AICredits is genuinely
 * OpenAI-compatible, this is close to a direct passthrough via raw fetch
 * (no SDK dependency, same style as AICreditsFixGenerator).
 *
 * Pinned to Stagehand 3.7.1, NOT the newer 4.0.0: 4.0.0 ships a bundled
 * browser extension whose Node-side RPC schema is out of sync with the
 * extension bundle in the same release (confirmed via a real call — act()/
 * observe() throw "invalid_union ... discriminator: outputFormat" regardless
 * of which LLM backs it). 3.7.1 doesn't use that extension architecture at
 * all, which is also why it doesn't hit the original Steel/CDP extension-
 * loading incompatibility documented in runAgentAttempt.ts — that failure
 * was specific to loading an extension into a remote, containerized browser
 * Stagehand didn't launch itself; a locally-launched browser has no such
 * container boundary to cross.
 */
export class AICreditsLLMClient extends LLMClient implements AgentLLMClient {
  readonly type = "openai" as const;
  /**
   * AICredits' response includes its own real per-call cost (INR) beyond
   * the standard OpenAI usage shape — accumulated here rather than
   * estimated from a hardcoded $/token table, so callers (the gate script,
   * primarily) report what was actually billed, not a guess. Every call
   * through this client instance (the agent loop's own "what's next"
   * decisions AND Stagehand's internal act()/observe() grounding calls,
   * since both go through the same stagehand.llmClient) is included.
   */
  private totalCostInr = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(
    modelName: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {
    super(modelName);
    this.hasVision = true;
  }

  getUsage(): AgentLLMUsage {
    return {
      provider: "aicredits",
      model: this.modelName,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      costInr: this.totalCostInr,
    };
  }

  async createChatCompletion<T = LLMResponse>({ options }: CreateChatCompletionOptions): Promise<T> {
    const { messages, temperature, tools, tool_choice, response_model, maxOutputTokens } = options as ChatCompletionOptions & {
      response_model?: { name: string; schema: ZodTypeAny };
    };

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      temperature: temperature ?? 0.2,
    };
    if (maxOutputTokens) body.max_tokens = maxOutputTokens;
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (tool_choice) body.tool_choice = tool_choice;
    }

    let requestMessages = messages;
    if (response_model) {
      // AICredits' google/gemini-2.5-pro route returned an empty {} for
      // response_format:"json_schema" (confirmed via a real call — real
      // tokens spent, nothing produced). Gemini's own structured-output
      // mechanism differs from OpenAI's json_schema wrapper and this
      // gateway's compatibility shim doesn't translate it correctly.
      // json_object mode (schema described in-prompt) is the same approach
      // already proven working in AICreditsFixGenerator.
      body.response_format = { type: "json_object" };
      const jsonSchema = zodToJsonSchema(response_model.schema, response_model.name);
      const schemaText = `\n\nRespond with a single JSON object matching this JSON Schema exactly (no other text, no markdown fences):\n${JSON.stringify(jsonSchema)}`;
      requestMessages = [...messages];
      const last = requestMessages[requestMessages.length - 1];
      if (last && typeof last.content === "string") {
        requestMessages[requestMessages.length - 1] = { ...last, content: last.content + schemaText };
      } else {
        requestMessages.push({ role: "user", content: schemaText });
      }
      body.messages = requestMessages;
    }

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`AICredits API returned ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const data = (await res.json()) as LLMResponse & { usage?: { cost?: number } };
    if (typeof data.usage?.cost === "number") this.totalCostInr += data.usage.cost;
    this.totalInputTokens += data.usage?.prompt_tokens ?? 0;
    this.totalOutputTokens += data.usage?.completion_tokens ?? 0;

    if (response_model) {
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("AICredits response missing message content for a structured request");
      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(content);
      } catch {
        throw new Error(`AICredits returned non-JSON content for a structured request: ${content.slice(0, 300)}`);
      }
      const validated = response_model.schema.safeParse(rawParsed);
      if (!validated.success) {
        throw new Error(`AICredits structured response didn't match the expected schema: ${validated.error.message}`);
      }
      return {
        data: validated.data,
        usage: {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0,
        },
      } as T;
    }

    return data as T;
  }
}
