/**
 * Abstracts the reasoning model behind the observe -> decide -> act loop.
 * Gemini computer-use is the only implementation for v1 (see
 * drivers/GeminiComputerUseDriver.ts), but the loop in runAgentAttempt.ts
 * only ever talks to this interface so a future model swap is a small change.
 */

export type AgentActionType =
  | "click"
  | "type"
  | "scroll"
  | "navigate"
  | "wait"
  | "finish"
  | "give_up";

export interface AgentAction {
  type: AgentActionType;
  /** CSS/aria/text target description for click/type actions, when the driver doesn't give coordinates. */
  target?: string;
  /** Text to type, a key combination, or a URL for navigate. */
  value?: string;
  /**
   * Coordinates for click/scroll/drag actions, normalized 0-1000 regardless
   * of actual screenshot size (Gemini computer-use's convention) — the
   * executor denormalizes against the real viewport before acting.
   * x2/y2 are the drag-and-drop endpoint.
   */
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  /** The model's own explanation for this action — shown in the live thought log. */
  reasoning: string;
}

export interface AgentStepHistoryEntry {
  stepNumber: number;
  action: AgentAction;
}

export interface AgentObservation {
  screenshot: Buffer;
  /** Optional accessibility-tree / DOM snapshot to ground the model, if the driver wants it. */
  domSnapshot?: string;
  goal: string;
  history: AgentStepHistoryEntry[];
}

export interface AgentDecision {
  action: AgentAction;
  /** Token/cost accounting for this single decision call — required for the Day-1 gate. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentDriver {
  readonly name: string;
  readonly modelVersion: string;

  decideNextAction(observation: AgentObservation): Promise<AgentDecision>;
}
