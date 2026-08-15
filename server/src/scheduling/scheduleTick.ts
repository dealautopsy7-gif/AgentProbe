import type { getSupabase } from "../lib/supabase.js";
import { getRunQueue } from "../lib/queue.js";
import type { ScheduleCadence } from "../types/db.js";

const CADENCE_MS: Record<ScheduleCadence, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * The recurring job Screen 9's schedules actually needed to not be inert:
 * for every schedule, works out whether its site is due (no prior run, or
 * its cadence interval has elapsed since the last done run) and enqueues a
 * real run if so — skipping sites that already have one in flight so
 * nothing doubles up if a scan runs long.
 */
export async function processScheduleTick(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const { data: schedules, error } = await supabase.from("schedules").select("*");
  if (error || !schedules || schedules.length === 0) return;

  for (const schedule of schedules) {
    const { data: site } = await supabase.from("sites").select("id, url").eq("id", schedule.site_id).maybeSingle();
    if (!site) continue;

    const { data: inFlight } = await supabase
      .from("runs")
      .select("id")
      .eq("site_id", site.id)
      .in("status", ["queued", "running"])
      .limit(1);
    if (inFlight && inFlight.length > 0) continue;

    const { data: lastRun } = await supabase
      .from("runs")
      .select("finished_at")
      .eq("site_id", site.id)
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cadenceMs = CADENCE_MS[schedule.cadence] ?? CADENCE_MS.weekly;
    const due = !lastRun?.finished_at || Date.now() - new Date(lastRun.finished_at).getTime() >= cadenceMs;
    if (!due) continue;

    const goals = Array.isArray(schedule.goals) ? (schedule.goals as string[]) : [];
    const goal = goals.length > 0 ? goals.join(", ") : "Complete a purchase";
    const attempts = 5;

    const { data: run, error: runError } = await supabase
      .from("runs")
      .insert({ site_id: site.id, user_id: schedule.user_id, goal, status: "queued", attempts_total: attempts })
      .select()
      .single();
    if (runError || !run) {
      console.error(`[schedule-tick] Failed to create run for site ${site.id}:`, runError);
      continue;
    }

    const job = await getRunQueue().add("run-agent-attempt", {
      runId: run.id,
      siteId: site.id,
      userId: schedule.user_id,
      url: site.url,
      goal,
      attempts,
      source: "schedule",
    });
    if (job.id) await supabase.from("runs").update({ bullmq_job_id: job.id }).eq("id", run.id);

    console.log(`[schedule-tick] Enqueued scheduled run ${run.id} for site ${site.id} (${schedule.cadence})`);
  }
}
