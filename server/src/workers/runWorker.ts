import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import { getSupabase } from "../lib/supabase.js";
import { getEnv } from "../config/env.js";
import { RUN_QUEUE_NAME, SCHEDULE_TICK_QUEUE_NAME, getScheduleTickQueue, type RunJobData } from "../lib/queue.js";
import { processScheduleTick } from "../scheduling/scheduleTick.js";
import { runAgentAttempt } from "../agent/runAgentAttempt.js";
import { runStagehandAttempt } from "../agent/runStagehandAttempt.js";
import { streamStubSteps, estimateStepUsage } from "../agent/stubRunAgentAttempt.js";
import { evaluateCheckpoints, type CheckpointResult } from "../agent/checkpoints.js";
import { computeScore } from "../agent/scoring.js";
import { generateFixes } from "../agent/fixGeneration.js";
import { GeminiComputerUseDriver } from "../agent/drivers/GeminiComputerUseDriver.js";
import { SteelBrowserProvider } from "../agent/providers/SteelBrowserProvider.js";
import { checkScheduledRunForAlert } from "../scheduling/alerts.js";
import type { AgentStepHistoryEntry } from "../agent/AgentDriver.js";

type AttemptRunResult = { checkpoints: CheckpointResult[]; usage: { inputTokens: number; outputTokens: number }; cancelled: boolean };

async function isRunCancelled(supabase: ReturnType<typeof getSupabase>, runId: string): Promise<boolean> {
  const { data } = await supabase.from("runs").select("status").eq("id", runId).maybeSingle();
  return data?.status === "cancelled";
}

/**
 * AGENT_MODE=live + BROWSER_PROVIDER=steel/browserbase path: one batched
 * insert per attempt via the coordinate-based observe/decide/act loop
 * (runAgentAttempt.ts + GeminiComputerUseDriver). Batched, not incremental,
 * because that path is reserved for the real Gemini computer-use model —
 * not exercised until that's funded (see LIVE-READINESS.md) — so there's
 * been no live traffic yet to motivate upgrading it to per-step writes.
 */
async function runSteelLiveAttempt(
  supabase: ReturnType<typeof getSupabase>,
  runId: string,
  attemptNumber: number,
  url: string,
  goal: string,
): Promise<AttemptRunResult> {
  const result = await runAgentAttempt({
    url,
    goal,
    browserProvider: new SteelBrowserProvider(),
    agentDriver: new GeminiComputerUseDriver(),
    recordVideo: true,
    isCancelled: () => isRunCancelled(supabase, runId),
  });

  const { data: attemptRow, error: attemptError } = await supabase
    .from("attempts")
    .insert({
      run_id: runId,
      attempt_number: attemptNumber,
      outcome: result.cancelled ? null : result.outcome,
      stuck_reason: result.cancelled ? null : (result.stuckReason ?? null),
      video_path: result.videoPath ?? null,
    })
    .select()
    .single();
  if (attemptError || !attemptRow) throw attemptError ?? new Error("Failed to insert attempt");

  if (result.checkpoints.length > 0) {
    await supabase.from("checkpoints").insert(
      result.checkpoints.map((cp) => ({ attempt_id: attemptRow.id, name: cp.name, passed: cp.passed, reason: cp.reason ?? null })),
    );
  }
  if (result.steps.length > 0) {
    await supabase.from("run_steps").insert(
      result.steps.map((s) => ({
        attempt_id: attemptRow.id,
        step_number: s.stepNumber,
        action: s.action.type,
        agent_reasoning: s.action.reasoning,
      })),
    );
  }

  return { checkpoints: result.checkpoints, usage: result.usage, cancelled: result.cancelled ?? false };
}

/**
 * AGENT_MODE=live + BROWSER_PROVIDER=local path: a real Chromium on this
 * machine, Stagehand for DOM grounding, AICredits for reasoning (see
 * runStagehandAttempt.ts). Writes the attempt row first (outcome: null,
 * same as the stub path) then each step as it's decided via the onStep
 * callback, so Live Run's Realtime subscription shows a real live run
 * progressing instead of going silent for the whole attempt.
 */
async function runLocalLiveAttempt(
  supabase: ReturnType<typeof getSupabase>,
  runId: string,
  attemptNumber: number,
  url: string,
  goal: string,
): Promise<AttemptRunResult> {
  const { data: attemptRow, error: attemptError } = await supabase
    .from("attempts")
    .insert({ run_id: runId, attempt_number: attemptNumber, outcome: null })
    .select()
    .single();
  if (attemptError || !attemptRow) throw attemptError ?? new Error("Failed to insert attempt");

  const result = await runStagehandAttempt({
    url,
    goal,
    recordVideo: true,
    isCancelled: () => isRunCancelled(supabase, runId),
    onStep: async (step, checkpointsSoFar) => {
      await supabase.from("run_steps").insert({
        attempt_id: attemptRow.id,
        step_number: step.stepNumber,
        action: step.action.type,
        agent_reasoning: step.action.reasoning,
      });
      await supabase
        .from("checkpoints")
        .upsert(
          checkpointsSoFar.map((cp) => ({ attempt_id: attemptRow.id, name: cp.name, passed: cp.passed, reason: cp.reason ?? null })),
          { onConflict: "attempt_id,name" },
        );
    },
  });

  if (!result.cancelled) {
    await supabase
      .from("attempts")
      .update({ outcome: result.outcome, stuck_reason: result.stuckReason ?? null, video_path: result.videoPath ?? null })
      .eq("id", attemptRow.id);
  }

  return { checkpoints: result.checkpoints, usage: result.usage, cancelled: result.cancelled ?? false };
}

function runLiveAttempt(
  supabase: ReturnType<typeof getSupabase>,
  runId: string,
  attemptNumber: number,
  url: string,
  goal: string,
): Promise<AttemptRunResult> {
  const provider = getEnv().BROWSER_PROVIDER;
  return provider === "local"
    ? runLocalLiveAttempt(supabase, runId, attemptNumber, url, goal)
    : runSteelLiveAttempt(supabase, runId, attemptNumber, url, goal);
}

/**
 * AGENT_MODE=stub path: writes the attempt row first (outcome: null, so
 * Realtime subscribers see "attempt started"), then each step as it's
 * produced, upserting checkpoints after every step so the Live Run
 * checkpoint rail updates progressively instead of jumping straight to a
 * final state. This is the actual streaming Screen 4 subscribes to.
 *
 * Checked for cancellation before writing each step — an attempt stopped
 * this way keeps outcome: null (it never concluded), same as the live path.
 */
async function runStubAttemptIncrementally(
  supabase: ReturnType<typeof getSupabase>,
  runId: string,
  attemptNumber: number,
  attemptIndex: number,
  totalAttempts: number,
): Promise<AttemptRunResult> {
  const { data: attemptRow, error: attemptError } = await supabase
    .from("attempts")
    .insert({ run_id: runId, attempt_number: attemptNumber, outcome: null })
    .select()
    .single();
  if (attemptError || !attemptRow) throw attemptError ?? new Error("Failed to insert attempt");

  const stepsSoFar: AgentStepHistoryEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastReasoning = "";
  let cancelled = false;

  for await (const step of streamStubSteps(attemptIndex, totalAttempts)) {
    if (await isRunCancelled(supabase, runId)) {
      cancelled = true;
      break;
    }

    lastReasoning = step.reasoning;
    stepsSoFar.push({ stepNumber: step.stepNumber, action: { type: step.type, reasoning: step.reasoning } });

    await supabase.from("run_steps").insert({
      attempt_id: attemptRow.id,
      step_number: step.stepNumber,
      action: step.type,
      agent_reasoning: step.reasoning,
    });

    const checkpoints = evaluateCheckpoints(stepsSoFar);
    await supabase
      .from("checkpoints")
      .upsert(
        checkpoints.map((cp) => ({ attempt_id: attemptRow.id, name: cp.name, passed: cp.passed })),
        { onConflict: "attempt_id,name" },
      );

    const usage = estimateStepUsage();
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }

  const finalCheckpoints = evaluateCheckpoints(stepsSoFar);

  if (!cancelled) {
    const reachedCheckout = finalCheckpoints.find((c) => c.name === "reached_checkout")?.passed ?? false;
    await supabase
      .from("attempts")
      .update({ outcome: reachedCheckout ? "success" : "fail", stuck_reason: reachedCheckout ? null : lastReasoning })
      .eq("id", attemptRow.id);
  }

  return { checkpoints: finalCheckpoints, usage: { inputTokens, outputTokens }, cancelled };
}

async function processRun(job: Job<RunJobData>) {
  const { runId, url, goal, attempts, source } = job.data;
  const supabase = getSupabase();
  const liveMode = getEnv().AGENT_MODE === "live";

  await supabase.from("runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", runId);

  const allCheckpoints: CheckpointResult[][] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber++) {
      if (await isRunCancelled(supabase, runId)) return; // status already set by POST /runs/:id/cancel

      const result = liveMode
        ? await runLiveAttempt(supabase, runId, attemptNumber, url, goal)
        : await runStubAttemptIncrementally(supabase, runId, attemptNumber, attemptNumber - 1, attempts);

      if (result.cancelled) return;

      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;
      allCheckpoints.push(result.checkpoints);
    }

    if (await isRunCancelled(supabase, runId)) return; // race: cancelled between last attempt and here

    const { score } = computeScore(allCheckpoints);
    const completionRate =
      allCheckpoints.filter((cps) => cps.find((c) => c.name === "reached_checkout")?.passed).length / attempts;

    // TODO: real cost accounting needs $/token pricing for the pinned
    // Gemini model plus browser-minute cost from the BrowserProvider —
    // wire both through once those integrations are live (meaningless in
    // stub mode, where nothing was actually spent). Token totals are
    // tracked (totalInputTokens/totalOutputTokens) so that math is a small
    // follow-up, not a rearchitecture.
    void totalInputTokens;
    void totalOutputTokens;

    await supabase
      .from("runs")
      .update({
        status: "done",
        score,
        completion_rate: completionRate,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await generateFixes(supabase, runId);

    if (source === "schedule") {
      await checkScheduledRunForAlert(supabase, runId).catch((err) => console.error(`Alert check failed for run ${runId}:`, err));
    }
  } catch (err) {
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("id", runId);
    throw err;
  }
}

const worker = new Worker<RunJobData>(RUN_QUEUE_NAME, processRun, {
  connection: getRedisConnection(),
  concurrency: 2, // headless browser sessions are expensive; keep this low
});

worker.on("failed", (job, err) => {
  console.error(`Run job ${job?.id} failed:`, err);
});

console.log(`AgentProbe run worker started (AGENT_MODE=${getEnv().AGENT_MODE})`);

// Screen 9's schedules were previously inert (saved, never acted on) — this
// is what actually makes them real: a repeatable job that ticks on an
// interval and enqueues due scans. Same process as the run worker above
// rather than a separate one, since there's no scale reason yet to split
// them.
const scheduleWorker = new Worker(SCHEDULE_TICK_QUEUE_NAME, () => processScheduleTick(getSupabase()), {
  connection: getRedisConnection(),
  concurrency: 1,
});
scheduleWorker.on("failed", (job, err) => console.error(`Schedule tick ${job?.id} failed:`, err));

getScheduleTickQueue()
  .upsertJobScheduler("schedule-tick", { every: getEnv().SCHEDULER_TICK_MS }, { name: "tick" })
  .then(() => console.log(`Schedule tick scheduler active (every ${getEnv().SCHEDULER_TICK_MS}ms)`))
  .catch((err) => console.error("Failed to set up schedule-tick scheduler:", err));
