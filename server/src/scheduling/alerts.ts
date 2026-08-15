import type { getSupabase } from "../lib/supabase.js";
import { sendAlertEmail } from "../lib/email.js";

/**
 * Called only for source:'schedule' runs (see runWorker.ts) — a score drop
 * on a run the user watched live doesn't need an alert, only ones that
 * happened unattended on a schedule.
 */
export async function checkScheduledRunForAlert(supabase: ReturnType<typeof getSupabase>, runId: string): Promise<void> {
  const { data: run } = await supabase.from("runs").select("id, site_id, user_id, score").eq("id", runId).maybeSingle();
  if (!run || run.score == null) return;

  const { data: schedule } = await supabase
    .from("schedules")
    .select("alert_threshold, alert_channels")
    .eq("site_id", run.site_id)
    .maybeSingle();
  if (!schedule) return; // monitoring may have been turned off between enqueue and completion

  const { data: previousRuns } = await supabase
    .from("runs")
    .select("score")
    .eq("site_id", run.site_id)
    .eq("status", "done")
    .neq("id", run.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const previousScore = previousRuns?.[0]?.score;
  if (previousScore == null) return; // first run for this site — nothing to compare against

  const drop = previousScore - run.score;
  if (drop < schedule.alert_threshold) return;

  const { data: site } = await supabase.from("sites").select("label, url").eq("id", run.site_id).maybeSingle();
  const siteLabel = site?.label || site?.url || "your site";

  const { data: alert, error } = await supabase
    .from("alerts")
    .insert({ site_id: run.site_id, user_id: run.user_id, old_score: previousScore, new_score: run.score, delivered: false })
    .select()
    .single();
  if (error || !alert) return;

  const channels = Array.isArray(schedule.alert_channels) ? (schedule.alert_channels as string[]) : [];
  if (!channels.includes("email")) return;

  const { data: userData } = await supabase.auth.admin.getUserById(run.user_id);
  const email = userData?.user?.email;
  if (!email) return;

  const sent = await sendAlertEmail({ to: email, siteLabel, oldScore: previousScore, newScore: run.score });
  if (sent) {
    await supabase.from("alerts").update({ delivered: true }).eq("id", alert.id);
  }
}
