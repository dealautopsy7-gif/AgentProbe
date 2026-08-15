/**
 * One-off verification script (not part of the app) — creates a site with
 * a fake "24h+ old" previous run at a high score, sets up a daily schedule
 * for it, manually invokes processScheduleTick (rather than waiting for
 * the real interval), waits for the resulting run to complete, and checks
 * whether an alert fired for the score drop.
 *
 * Run with: npx tsx scripts/verify-schedule-tick.ts
 * Requires the worker (npm run worker) to be running to process the
 * enqueued run.
 */
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../src/config/env.js";
import { processScheduleTick } from "../src/scheduling/scheduleTick.js";
import type { Database } from "../src/types/db.js";

async function main() {
  const env = getEnv();
  const admin = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const email = `schedule-verify-${Date.now()}@agentprobe-test.local`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: "Verify-Schedule-123!", email_confirm: true });
  if (createErr || !created.user) throw createErr ?? new Error("createUser failed");
  const userId = created.user.id;

  try {
    const { data: site, error: siteErr } = await admin
      .from("sites")
      .insert({ user_id: userId, url: "https://schedule-verify.example", label: "schedule-verify.example" })
      .select()
      .single();
    if (siteErr || !site) throw siteErr ?? new Error("site insert failed");

    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { error: prevRunErr } = await admin.from("runs").insert({
      site_id: site.id,
      user_id: userId,
      goal: "baseline",
      status: "done",
      score: 90,
      completion_rate: 1,
      attempts_total: 5,
      started_at: twentyFiveHoursAgo,
      finished_at: twentyFiveHoursAgo,
    });
    if (prevRunErr) throw prevRunErr;

    const { data: schedule, error: schedErr } = await admin
      .from("schedules")
      .insert({ site_id: site.id, user_id: userId, cadence: "daily", goals: [], alert_threshold: 10, alert_channels: ["email"] })
      .select()
      .single();
    if (schedErr || !schedule) throw schedErr ?? new Error("schedule insert failed");
    console.log(`Site ${site.id} has a 25h-old run at score 90, daily schedule with alert_threshold=10.`);

    console.log("\nInvoking processScheduleTick()…");
    await processScheduleTick(admin);

    const { data: newRuns } = await admin
      .from("runs")
      .select("id, status, score")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const newRun = newRuns?.[0];
    if (!newRun) {
      throw new Error("FAIL: processScheduleTick did not enqueue a new run (is the site actually due? check cadence math).");
    }
    console.log(`New scheduled run created: ${newRun.id}, status=${newRun.status}`);

    console.log("Waiting for the worker to process it (requires `npm run worker` running)…");
    let finalStatus = newRun.status;
    let finalScore: number | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: r } = await admin.from("runs").select("status, score").eq("id", newRun.id).maybeSingle();
      if (!r) continue;
      finalStatus = r.status;
      finalScore = r.score;
      process.stdout.write(`  [${i}] status=${r.status} `);
      if (r.status === "done" || r.status === "failed") {
        console.log("-> finished");
        break;
      }
      console.log();
    }

    if (finalStatus !== "done") {
      throw new Error(`FAIL: run ended with status=${finalStatus}, expected done.`);
    }
    console.log(`\nRun finished with score=${finalScore} (previous was 90).`);

    // Give checkScheduledRunForAlert (called right after status:'done') a moment.
    await new Promise((r) => setTimeout(r, 1500));

    const { data: alerts } = await admin.from("alerts").select("*").eq("site_id", site.id);
    console.log(`\nAlerts for this site: ${alerts?.length ?? 0}`);
    if (alerts && alerts.length > 0) {
      console.log(JSON.stringify(alerts[0], null, 2));
      console.log("\nPASS: alert fired for the score drop, as expected (drop >= threshold 10).");
    } else if (finalScore != null && 90 - finalScore >= 10) {
      throw new Error("FAIL: score dropped enough to warrant an alert, but none was recorded.");
    } else {
      console.log("(No alert expected — the drop didn't meet the threshold this run.)");
    }
  } finally {
    console.log(`\nCleaning up test user ${userId}…`);
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
