import { Environment, GoogleGenAI, type Chat, type FunctionCall, type Part } from "@google/genai";
import { getEnv } from "../../config/env.js";
import type { AgentAction, AgentActionType, AgentDecision, AgentDriver, AgentObservation } from "../AgentDriver.js";

/**
 * Maps Gemini's predefined computer-use function names to our AgentActionType.
 * Assembled from Google's documented action vocabulary — NOT verified against
 * a live response before the Day-1 gate run, since doing so requires the
 * very API call this driver makes. An unrecognized name is logged loudly and
 * treated as "wait" (a safe no-op) rather than crashing the attempt or
 * silently dropping the step; check server logs after the first live run and
 * extend this map from what Gemini actually returned.
 */
const ACTION_MAP: Record<string, AgentActionType> = {
  open_web_browser: "navigate",
  navigate: "navigate",
  go_back: "navigate",
  go_forward: "navigate",
  click_at: "click",
  double_click_at: "click",
  triple_click_at: "click",
  hover_at: "click",
  drag_and_drop: "click",
  type_text_at: "type",
  key_combination: "type",
  scroll_document: "scroll",
  scroll_at: "scroll",
  wait_5_seconds: "wait",
  wait: "wait",
};

function toAgentAction(call: FunctionCall): AgentAction {
  const name = call.name ?? "";
  const args = (call.args ?? {}) as Record<string, unknown>;
  const type = ACTION_MAP[name];

  if (!type) {
    console.warn(`[GeminiComputerUseDriver] Unrecognized action "${name}" with args`, args, "— treating as wait.");
    return { type: "wait", reasoning: `Unrecognized model action: ${name}` };
  }

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  return {
    type,
    x: num(args.x),
    y: num(args.y),
    x2: num(args.destination_x ?? args.x2),
    y2: num(args.destination_y ?? args.y2),
    value: typeof args.text === "string" ? args.text : typeof args.keys === "string" ? args.keys : typeof args.url === "string" ? args.url : undefined,
    reasoning: typeof args.intent === "string" ? args.intent : `${name}(${JSON.stringify(args)})`,
  };
}

export class GeminiComputerUseDriver implements AgentDriver {
  readonly name = "gemini-computer-use";
  readonly modelVersion: string;
  private ai: GoogleGenAI;
  private chat: Chat | null = null;
  private lastCall: FunctionCall | null = null;

  constructor() {
    const env = getEnv();
    const model = env.GEMINI_COMPUTER_USE_MODEL;
    // env.ts only requires this when AGENT_MODE=live; this constructor should
    // only ever be reached in that mode (see runWorker.ts's runOneAttempt),
    // but the field itself stays optional in the schema so stub mode never
    // needs a placeholder value — this is the actual enforcement point.
    if (!model) {
      throw new Error("GEMINI_COMPUTER_USE_MODEL is not set — required when AGENT_MODE=live");
    }
    this.modelVersion = model;
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async decideNextAction(observation: AgentObservation): Promise<AgentDecision> {
    const imagePart: Part = {
      inlineData: { mimeType: "image/png", data: observation.screenshot.toString("base64") },
    };

    let message: Part[];
    if (!this.chat) {
      this.chat = this.ai.chats.create({
        model: this.modelVersion,
        config: { tools: [{ computerUse: { environment: Environment.ENVIRONMENT_BROWSER } }] },
      });
      message = [{ text: `Goal: ${observation.goal}\n\nHere is the current screen.` }, imagePart];
    } else if (this.lastCall) {
      // Echo the previous function call's result back, per the computer-use
      // loop: send the outcome + fresh screenshot, get the next action.
      message = [
        {
          functionResponse: {
            id: this.lastCall.id,
            name: this.lastCall.name,
            response: { status: "completed" },
            parts: [{ inlineData: { mimeType: "image/png", data: observation.screenshot.toString("base64") } }],
          },
        },
      ];
    } else {
      message = [{ text: "Here is the current screen." }, imagePart];
    }

    const response = await this.chat.sendMessage({ message });
    const usage = {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };

    const call = response.functionCalls?.[0];
    if (!call) {
      this.lastCall = null;
      return {
        action: { type: "give_up", reasoning: response.text ?? "Model returned no action and no text." },
        usage,
      };
    }

    this.lastCall = call;
    return { action: toAgentAction(call), usage };
  }
}
