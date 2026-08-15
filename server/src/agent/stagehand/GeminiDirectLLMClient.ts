import { GoogleGenAI, type Content, type Part } from "@google/genai";
import {
  LLMClient,
  type ChatCompletionOptions,
  type ChatMessage,
  type CreateChatCompletionOptions,
  type LLMResponse,
} from "@browserbasehq/stagehand";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentLLMClient, AgentLLMUsage } from "./AgentLLMClient.js";

/**
 * Google Gemini, called directly (first-party `@google/genai`, already a
 * dependency — no new package needed). Parallel to AICreditsLLMClient:
 * both extend Stagehand's own abstract `LLMClient`, so
 * runStagehandAttempt.ts can use either interchangeably and never has to
 * know which is active.
 *
 * ============================ UNTESTED ============================
 * As of 2026-08-13 this has NEVER made a real API call — there is no
 * funded Gemini key (free-tier keys 0-quota-fail; GCP billing isn't
 * funded until ~Aug 20). It typechecks, and its wiring/fail-fast paths are
 * verified, but the request/response translation below is written from the
 * SDK's type definitions, not confirmed against a live response. Expect to
 * debug it on first real use — see LIVE-READINESS.md. AICredits remains
 * the only agent-reasoning path proven end to end.
 * ==================================================================
 *
 * Translation notes (Stagehand speaks OpenAI's shapes; Gemini does not):
 *  - `system` messages -> `config.systemInstruction` (Gemini has no system role in `contents`)
 *  - `assistant` role  -> `model` role
 *  - `image_url` data URIs -> `inlineData: { mimeType, data }`
 *  - structured output -> `responseMimeType: "application/json"` + the JSON
 *    Schema described in the prompt, deliberately NOT `responseSchema`.
 *    Rationale: Gemini's `responseSchema` accepts only an OpenAPI subset and
 *    rejects common JSON-Schema output (`$schema`, `additionalProperties`,
 *    `nullable` unions, `$ref`), which is exactly what zodToJsonSchema
 *    emits. Describing the schema in-prompt is the same approach already
 *    proven against AICredits in this codebase, and it degrades gracefully
 *    instead of erroring on a schema shape the API dislikes. If Gemini's
 *    native responseSchema turns out to work cleanly on Aug 20, upgrading
 *    to it is a small, contained change here.
 */
export class GeminiDirectLLMClient extends LLMClient implements AgentLLMClient {
  readonly type = "google" as const;
  private readonly ai: GoogleGenAI;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(modelName: string, apiKey: string) {
    super(modelName);
    this.hasVision = true;
    this.ai = new GoogleGenAI({ apiKey });
  }

  getUsage(): AgentLLMUsage {
    return {
      provider: "gemini",
      model: this.modelName,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      // Gemini's API does not report billed cost — the caller must
      // estimate it from tokens. null (not 0) so nothing can mistake this
      // for "it was free".
      costInr: null,
    };
  }

  async createChatCompletion<T = LLMResponse>({ options }: CreateChatCompletionOptions): Promise<T> {
    const { messages, temperature, response_model, maxOutputTokens } = options as ChatCompletionOptions & {
      response_model?: { name: string; schema: ZodTypeAny };
    };

    const systemInstruction = messages
      .filter((m) => m.role === "system")
      .map((m) => flattenToText(m.content))
      .filter(Boolean)
      .join("\n\n");

    const contents: Content[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(m.content),
      }));

    if (response_model) {
      const jsonSchema = zodToJsonSchema(response_model.schema, response_model.name);
      const schemaText = `\n\nRespond with a single JSON object matching this JSON Schema exactly (no other text, no markdown fences):\n${JSON.stringify(jsonSchema)}`;
      const last = contents[contents.length - 1];
      if (last?.parts) last.parts.push({ text: schemaText });
      else contents.push({ role: "user", parts: [{ text: schemaText }] });
    }

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        temperature: temperature ?? 0.2,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(response_model ? { responseMimeType: "application/json" } : {}),
      },
    });

    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    // 2.5-series models bill "thinking" tokens as output; counting only
    // candidatesTokenCount would understate real cost, sometimes badly.
    const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    const text = response.text ?? "";

    if (response_model) {
      if (!text) throw new Error("Gemini returned no text content for a structured request");
      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(stripCodeFences(text));
      } catch {
        throw new Error(`Gemini returned non-JSON content for a structured request: ${text.slice(0, 300)}`);
      }
      const validated = response_model.schema.safeParse(rawParsed);
      if (!validated.success) {
        throw new Error(`Gemini structured response didn't match the expected schema: ${validated.error.message}`);
      }
      return {
        data: validated.data,
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      } as T;
    }

    // Unstructured path: hand back the OpenAI-shaped response Stagehand
    // expects, synthesised from Gemini's.
    const llmResponse: LLMResponse = {
      id: response.responseId ?? "gemini",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.modelName,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text, tool_calls: [] },
          finish_reason: response.candidates?.[0]?.finishReason ?? "stop",
        },
      ],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    };
    return llmResponse as T;
  }
}

/**
 * Models occasionally wrap JSON in ```json fences despite
 * responseMimeType: "application/json". Cheap to tolerate, annoying to
 * debug if we don't.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function flattenToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((c) => (c as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
}

function toGeminiParts(content: ChatMessage["content"]): Part[] {
  if (typeof content === "string") return [{ text: content }];

  const parts: Part[] = [];
  for (const rawBlock of content) {
    // Stagehand's ChatMessageContent union is loosely typed (its image
    // variant carries optional `text` too), so read through a widened view
    // rather than fighting the discriminator.
    const block = rawBlock as {
      type?: string;
      text?: string;
      image_url?: { url?: string };
      source?: { type?: string; media_type?: string; data?: string };
    };

    // Anthropic-style image block.
    if (block.source?.data) {
      parts.push({ inlineData: { mimeType: block.source.media_type ?? "image/png", data: block.source.data } });
      continue;
    }
    if (block.image_url?.url) {
      const parsed = parseDataUri(block.image_url.url);
      if (parsed) parts.push({ inlineData: parsed });
      // A non-data: URL is skipped deliberately — Gemini needs inline bytes
      // or a Files-API handle, and silently sending a bare URL as text
      // would look like it worked while the model saw no image at all.
      continue;
    }
    if (block.text) parts.push({ text: block.text });
  }
  return parts.length > 0 ? parts : [{ text: "" }];
}

function parseDataUri(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  const mimeType = match?.[1];
  const data = match?.[2];
  if (!mimeType || !data) return null;
  return { mimeType, data };
}
