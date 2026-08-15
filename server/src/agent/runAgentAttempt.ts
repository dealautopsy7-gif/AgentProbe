import { chromium, type Browser, type Page } from "playwright-core";
import type { AgentAction, AgentDriver, AgentStepHistoryEntry } from "./AgentDriver.js";
import type { BrowserProvider, BrowserSession } from "./BrowserProvider.js";
import { evaluateCheckpoints, type CheckpointResult } from "./checkpoints.js";

const STEP_CAP = 25;
const VIEWPORT = { width: 1440, height: 900 };
/** AgentDriver contract: all drivers return click/scroll/drag coordinates normalized 0-1000, regardless of actual viewport size. */
const COORDINATE_SCALE = 1000;

/**
 * Action types the agent must never be allowed to execute, regardless of
 * what the model decides. This is the actual enforcement point for the
 * product's non-negotiable safety rule ("never completes a real purchase
 * and never spends real money") — defense in depth alongside the checkout
 * hard-stop below, in case a future action type (e.g. "submit_payment")
 * gets added to AgentActionType without this list being updated. Checked
 * against reasoning/target/value together since a coordinate-based driver
 * (Gemini computer-use) mostly populates reasoning, not target.
 */
const FORBIDDEN_ACTION_TARGETS = /submit.*payment|place.*order|confirm.*purchase|pay now|complete purchase/i;

export interface RunAgentAttemptInput {
  url: string;
  goal: string;
  browserProvider: BrowserProvider;
  agentDriver: AgentDriver;
  recordVideo: boolean;
  /**
   * Checked between every step — real "Stop run" support for live mode.
   * An active job can't be force-killed from outside BullMQ, so this
   * cooperative check (backed by a runs.status read in runWorker.ts) is
   * the actual cancellation mechanism once a run is mid-attempt.
   */
  isCancelled?: () => Promise<boolean>;
}

export interface RunAgentAttemptResult {
  outcome: "success" | "fail" | "blocked";
  /** True if this attempt stopped because the run was cancelled mid-step — outcome/stuckReason are not meaningful in that case. */
  cancelled?: boolean;
  stuckReason?: string;
  steps: AgentStepHistoryEntry[];
  checkpoints: CheckpointResult[];
  videoPath?: string;
  usage: { inputTokens: number; outputTokens: number };
}

function isForbidden(action: AgentAction): boolean {
  const text = `${action.reasoning ?? ""} ${action.target ?? ""} ${action.value ?? ""}`;
  return FORBIDDEN_ACTION_TARGETS.test(text);
}

function denorm(value: number | undefined, dimension: number): number {
  return Math.round(((value ?? 0) / COORDINATE_SCALE) * dimension);
}

/** Executes one decided action against the live page. Never called for finish/give_up/blocked. */
async function executeAction(page: Page, action: AgentAction, goalUrl: string): Promise<void> {
  switch (action.type) {
    case "navigate":
      await page.goto(action.value || goalUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
      return;
    case "click": {
      const x = denorm(action.x, VIEWPORT.width);
      const y = denorm(action.y, VIEWPORT.height);
      if (action.x2 != null && action.y2 != null) {
        const x2 = denorm(action.x2, VIEWPORT.width);
        const y2 = denorm(action.y2, VIEWPORT.height);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x2, y2);
        await page.mouse.up();
      } else {
        await page.mouse.click(x, y).catch(() => undefined);
      }
      return;
    }
    case "type": {
      if (action.x != null && action.y != null) {
        await page.mouse.click(denorm(action.x, VIEWPORT.width), denorm(action.y, VIEWPORT.height)).catch(() => undefined);
      }
      if (action.value) await page.keyboard.type(action.value, { delay: 15 }).catch(() => undefined);
      return;
    }
    case "scroll": {
      const x = denorm(action.x, VIEWPORT.width);
      const y = denorm(action.y, VIEWPORT.height);
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 400).catch(() => undefined);
      return;
    }
    case "wait":
      await page.waitForTimeout(1000);
      return;
  }
}

/**
 * The core observe -> decide -> act loop (spec: "the heart of the
 * product"). One call = one attempt; runWorker.ts calls this N times per
 * run and aggregates.
 *
 * Real wiring (AGENT_MODE=live): connects Playwright directly to the
 * BrowserProvider's CDP session (`chromium.connectOverCDP`), not Stagehand —
 * Stagehand needs to inject its own browser extension via CDP
 * (`Extensions.loadUnpacked`) pointing at a local file path, which fails
 * against a containerized remote browser like Steel's (the path isn't
 * resolvable across the container boundary; confirmed by trying it before
 * writing this). Plain Playwright's `connectOverCDP` has no such
 * requirement and is all this loop actually needs — coordinate-based
 * click/type/scroll, matching Gemini computer-use's own action vocabulary.
 */
export async function runAgentAttempt(input: RunAgentAttemptInput): Promise<RunAgentAttemptResult> {
  const { url, goal, browserProvider, agentDriver, recordVideo, isCancelled } = input;

  let session: BrowserSession | undefined;
  let browser: Browser | undefined;
  const history: AgentStepHistoryEntry[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let stuckReason: string | undefined;
  let blocked = false;
  let cancelled = false;

  try {
    session = await browserProvider.createSession({ recordVideo });
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: VIEWPORT }));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(VIEWPORT).catch(() => undefined);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    for (let stepNumber = 1; stepNumber <= STEP_CAP; stepNumber++) {
      if (isCancelled && (await isCancelled())) {
        cancelled = true;
        break;
      }

      const screenshot = await page.screenshot({ type: "png" });

      const decision = await agentDriver.decideNextAction({ screenshot, goal, history });
      usage.inputTokens += decision.usage.inputTokens;
      usage.outputTokens += decision.usage.outputTokens;

      const { action } = decision;

      if (isForbidden(action)) {
        blocked = true;
        stuckReason = `Blocked forbidden action: ${action.type} ${action.reasoning}`;
        history.push({ stepNumber, action });
        break;
      }

      history.push({ stepNumber, action });

      if (action.type === "finish") break;
      if (action.type === "give_up") {
        stuckReason = action.reasoning;
        break;
      }

      // Non-negotiable hard stop: the moment "reached_checkout" is true,
      // the loop ends here — no further actions are ever taken, so payment
      // steps are structurally unreachable regardless of what the model
      // does next.
      const runningCheckpoints = evaluateCheckpoints(history);
      if (runningCheckpoints.find((c) => c.name === "reached_checkout")?.passed) {
        break;
      }

      await executeAction(page, action, url);
    }

    const checkpoints = evaluateCheckpoints(history);
    const reachedCheckout = checkpoints.find((c) => c.name === "reached_checkout")?.passed ?? false;

    await browser.close().catch(() => undefined);
    const { videoPath } = await browserProvider.closeSession(session);

    return {
      outcome: blocked ? "blocked" : reachedCheckout ? "success" : "fail",
      cancelled,
      stuckReason,
      steps: history,
      checkpoints,
      videoPath,
      usage,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => undefined);
    if (session) {
      await browserProvider.closeSession(session).catch(() => undefined);
    }
    throw err;
  }
}
