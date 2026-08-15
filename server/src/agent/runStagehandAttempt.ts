import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getAgentLLMClient, type AgentLLMUsage } from "./stagehand/index.js";
import { evaluateCheckpoints, type CheckpointResult } from "./checkpoints.js";
import type { AgentAction, AgentActionType, AgentStepHistoryEntry } from "./AgentDriver.js";

const STEP_CAP = 25;

/**
 * Same enforcement point as runAgentAttempt.ts's FORBIDDEN_ACTION_TARGETS —
 * duplicated rather than imported because this loop checks it *before*
 * deciding to act at all (never even asks Stagehand to ground a forbidden
 * instruction), whereas the coordinate-based loop checks after deciding but
 * before executing. Keep both in sync if this pattern ever changes.
 */
const FORBIDDEN_ACTION_TARGETS = /submit.*payment|place.*order|confirm.*purchase|pay now|complete purchase/i;

function isForbidden(text: string): boolean {
  return FORBIDDEN_ACTION_TARGETS.test(text);
}

interface NextStepDecision {
  type: AgentActionType;
  instruction?: string | null;
  value?: string | null;
  reasoning: string;
}

// .nullish() (not just .optional()) on instruction/value: confirmed via a
// real run that the model sometimes returns explicit `null` for fields it
// considers not applicable to the chosen type (e.g. "wait") rather than
// omitting the key — plain .optional() rejects an explicit null, which
// crashed a real in-progress live run before this fix.
const NEXT_STEP_SCHEMA = z.object({
  type: z.enum(["click", "type", "scroll", "navigate", "wait", "finish", "give_up"]),
  instruction: z
    .string()
    .nullish()
    .describe("Natural-language description of the element/action for click/type/scroll, e.g. \"click the Add to Cart button\" or \"type 'blue' into the size selector\"."),
  value: z.string().nullish().describe("URL to navigate to, only when type is 'navigate'."),
  reasoning: z.string().describe("Why this is the right next step."),
});

function isNextStepDecision(v: unknown): v is NextStepDecision {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return typeof d.type === "string" && typeof d.reasoning === "string";
}

async function decideNextStep(
  stagehand: Stagehand,
  goal: string,
  history: AgentStepHistoryEntry[],
  screenshot: Buffer,
): Promise<{ decision: NextStepDecision; usage: { inputTokens: number; outputTokens: number } }> {
  const historyText =
    history.length === 0
      ? "(no steps yet)"
      : history.map((h, i) => `${i + 1}. [${h.action.type}] ${h.action.target ?? ""} — ${h.action.reasoning}`).join("\n");

  const promptText = `You are directing a browser automation agent (Stagehand) one step at a time toward this goal:\n\nGoal: ${goal}\n\nSteps taken so far:\n${historyText}\n\nLooking at the current screenshot, decide the SINGLE next step. Use "click"/"type"/"scroll" with a clear natural-language "instruction" describing the target element and action (Stagehand will locate and perform it — you never give coordinates). Use "navigate" with a "value" URL only if you need to go to a different page directly. Use "wait" to pause briefly. Use "finish" once the goal is achieved. Use "give_up" only if truly stuck, with the reason in "reasoning". Never plan any step that submits payment, places an order, or confirms a purchase — the run always stops at checkout, never past it.`;

  const result = (await stagehand.llmClient.createChatCompletion({
    options: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot.toString("base64")}` } },
          ],
        },
      ],
      response_model: { name: "NextStep", schema: NEXT_STEP_SCHEMA },
    },
    logger: () => {},
  })) as { data: unknown; usage?: { prompt_tokens: number; completion_tokens: number } };

  if (!isNextStepDecision(result.data)) {
    return {
      decision: { type: "give_up", reasoning: "Model returned an unparseable step decision." },
      usage: { inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0 },
    };
  }

  return {
    decision: result.data,
    usage: { inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0 },
  };
}

export interface RunStagehandAttemptInput {
  url: string;
  goal: string;
  recordVideo: boolean;
  isCancelled?: () => Promise<boolean>;
  /**
   * Called after each step is decided (and, for non-terminal steps, acted
   * on) with the running history and freshly-evaluated checkpoints so far —
   * lets the caller write to run_steps/checkpoints immediately instead of
   * waiting for the whole attempt to finish, which is what makes Live Run's
   * Realtime streaming show a real live-mode run progressing instead of
   * going silent for the full attempt duration then dumping everything at
   * once. Errors from this callback are logged, not thrown — a DB write
   * hiccup on one step must never abort an in-progress paid model run.
   */
  onStep?: (step: AgentStepHistoryEntry, checkpointsSoFar: CheckpointResult[]) => Promise<void>;
  /**
   * Overrides AGENT_LLM_PROVIDER for this attempt only — used by the gate
   * script's --provider flag so a cost comparison between providers
   * doesn't require editing .env between runs.
   */
  llmProvider?: string;
}

export interface RunStagehandAttemptResult {
  outcome: "success" | "fail" | "blocked";
  cancelled?: boolean;
  stuckReason?: string;
  steps: AgentStepHistoryEntry[];
  checkpoints: CheckpointResult[];
  videoPath?: string;
  /**
   * Covers every model call the attempt made — this loop's own step
   * decisions AND Stagehand's internal grounding calls — since both go
   * through the same client. `costInr` is null when the provider doesn't
   * report cost (Gemini); see AgentLLMUsage.
   */
  usage: AgentLLMUsage;
}

/**
 * The BROWSER_PROVIDER=local live path: a real Chromium on this machine,
 * driven by Stagehand (act()/observe() do the actual DOM grounding), with
 * the configured AGENT_LLM_PROVIDER (AICredits by default, or Gemini
 * directly) providing two kinds of reasoning — this loop's own "what's the
 * next step" decision, and Stagehand's internal grounding call for whatever
 * instruction gets handed to act(). That means each step here is ~2 real
 * model calls, not 1 — relevant for cost.
 *
 * Deliberately NOT the same code path as runAgentAttempt.ts (the Steel/
 * Browserbase + GeminiComputerUseDriver coordinate-based loop): Stagehand
 * owns its own local browser lifecycle rather than connecting into a
 * pre-existing remote CDP session, and act() takes natural-language
 * instructions rather than pixel coordinates — different enough in shape
 * that forcing both through one loop would make neither one clear.
 */
export async function runStagehandAttempt(input: RunStagehandAttemptInput): Promise<RunStagehandAttemptResult> {
  const { url, goal, recordVideo, isCancelled, onStep, llmProvider } = input;
  const env = getEnv();

  // Throws with an actionable message if the selected provider's key is
  // missing — before a browser is launched or a token is spent.
  const llmClient = getAgentLLMClient(llmProvider);
  const stagehand = new Stagehand({
    env: "LOCAL",
    llmClient,
    localBrowserLaunchOptions: {
      executablePath: env.LOCAL_CHROME_PATH || undefined,
      headless: true,
      args: ["--no-sandbox"],
    },
    disablePino: true,
  });

  const history: AgentStepHistoryEntry[] = [];
  let stuckReason: string | undefined;
  let blocked = false;
  let cancelled = false;

  let screenshotDir: string | null = null;
  if (recordVideo) {
    screenshotDir = path.join(tmpdir(), `agentprobe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(screenshotDir, { recursive: true });
  }

  try {
    await stagehand.init();
    const page = stagehand.context.activePage() ?? stagehand.context.pages()[0];
    if (!page) throw new Error("Stagehand did not provide a page after init()");
    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 20000 }).catch(() => undefined);

    for (let stepNumber = 1; stepNumber <= STEP_CAP; stepNumber++) {
      if (isCancelled && (await isCancelled())) {
        cancelled = true;
        break;
      }

      const screenshot = await page.screenshot();
      if (screenshotDir) {
        await writeFile(path.join(screenshotDir, `step-${String(stepNumber).padStart(3, "0")}.png`), screenshot);
      }

      // Token/cost totals come from llmClient.getUsage() at the end rather
      // than being summed here — the client sees Stagehand's internal
      // grounding calls too, which this loop never observes directly.
      const { decision } = await decideNextStep(stagehand, goal, history, screenshot);

      const action: AgentAction = {
        type: decision.type,
        target: decision.instruction ?? undefined,
        value: decision.value ?? undefined,
        reasoning: decision.reasoning,
      };

      if (isForbidden(`${action.reasoning} ${action.target ?? ""} ${action.value ?? ""}`)) {
        blocked = true;
        stuckReason = `Blocked forbidden action: ${action.type} ${action.reasoning}`;
        history.push({ stepNumber, action });
        await onStep?.({ stepNumber, action }, evaluateCheckpoints(history)).catch((err) =>
          console.error("[runStagehandAttempt] onStep callback failed:", err),
        );
        break;
      }

      history.push({ stepNumber, action });
      const runningCheckpoints = evaluateCheckpoints(history);
      await onStep?.({ stepNumber, action }, runningCheckpoints).catch((err) =>
        console.error("[runStagehandAttempt] onStep callback failed:", err),
      );

      if (action.type === "finish") break;
      if (action.type === "give_up") {
        stuckReason = action.reasoning;
        break;
      }

      if (runningCheckpoints.find((c) => c.name === "reached_checkout")?.passed) break;

      if (action.type === "navigate" && action.value) {
        await page.goto(action.value, { waitUntil: "domcontentloaded", timeoutMs: 15000 }).catch(() => undefined);
      } else if (action.type === "wait") {
        await page.waitForTimeout(1500);
      } else if (action.target) {
        await stagehand.act(action.target).catch((err) => {
          console.warn(`[runStagehandAttempt] act() failed for "${action.target}":`, err instanceof Error ? err.message : err);
        });
      }
    }

    const checkpoints = evaluateCheckpoints(history);
    const reachedCheckout = checkpoints.find((c) => c.name === "reached_checkout")?.passed ?? false;

    let videoPath: string | undefined;
    if (screenshotDir && !cancelled) {
      videoPath = await assembleAndUploadVideo(screenshotDir, history, stuckReason).catch((err) => {
        console.error("[runStagehandAttempt] video assembly/upload failed:", err);
        return undefined;
      });
    }
    if (screenshotDir) await rm(screenshotDir, { recursive: true, force: true }).catch(() => undefined);

    await stagehand.close().catch(() => undefined);

    return {
      outcome: blocked ? "blocked" : reachedCheckout ? "success" : "fail",
      cancelled,
      stuckReason,
      steps: history,
      checkpoints,
      videoPath,
      usage: llmClient.getUsage(),
    };
  } catch (err) {
    await stagehand.close().catch(() => undefined);
    if (screenshotDir) await rm(screenshotDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

async function assembleAndUploadVideo(
  screenshotDir: string,
  history: AgentStepHistoryEntry[],
  stuckReason: string | undefined,
): Promise<string | undefined> {
  const files = (await readdir(screenshotDir)).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) return undefined;

  const { assembleScreenshotsToVideo, trimHighlightClip } = await import("./videoPipeline.js");
  const { getSupabase } = await import("../lib/supabase.js");
  const env = getEnv();

  const rawPath = path.join(screenshotDir, "raw.mp4");
  await assembleScreenshotsToVideo({ screenshotDir, outputPath: rawPath, framesPerSecond: 1 });

  const failureStepIndex = Math.max(0, history.length - 1);
  const captionText = (stuckReason ?? history.at(-1)?.action.reasoning ?? "Run ended").slice(0, 140);

  const trimmedPath = path.join(screenshotDir, "highlight.mp4");
  await trimHighlightClip({
    inputPath: rawPath,
    outputPath: trimmedPath,
    failureTimestampSec: failureStepIndex,
    captionText,
    windowSec: { before: 5, after: 3 },
  });

  const fileBuffer = await readFile(trimmedPath);
  const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const { error } = await getSupabase().storage.from(env.VIDEO_STORAGE_BUCKET).upload(storagePath, fileBuffer, { contentType: "video/mp4" });
  if (error) throw error;

  return storagePath;
}
