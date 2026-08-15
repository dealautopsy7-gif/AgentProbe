import { Router } from "express";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const sitesRouter = Router();
sitesRouter.use(requireAuth);

const CreateSiteSchema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
});

const AlertsSchema = z.object({
  alertThreshold: z.number().int().min(1).max(100),
  alertChannels: z.array(z.enum(["email"])).default(["email"]),
});

/**
 * Screen 7 (dashboard): each site joined with its latest done run, the
 * previous run's score (for the red-row delta), a compact sparkline
 * series, and a monitoring state derived from whether a schedule exists —
 * there's no separate "paused" flag in the schema, so state is only ever
 * one of monitored / not_monitored / never_run, never a fabricated pause.
 */
sitesRouter.get("/", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const userId = req.userId!;
    const { data: sites, error } = await supabase
      .from("sites")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!sites || sites.length === 0) return res.json({ sites: [] });

    const siteIds = sites.map((s) => s.id);
    const [{ data: runs, error: runsError }, { data: schedules, error: schedulesError }] = await Promise.all([
      supabase
        .from("runs")
        .select("id, site_id, score, completion_rate, status, finished_at")
        .in("site_id", siteIds)
        .eq("status", "done")
        .order("finished_at", { ascending: false }),
      supabase.from("schedules").select("site_id").in("site_id", siteIds),
    ]);
    if (runsError) throw runsError;
    if (schedulesError) throw schedulesError;

    const scheduledSiteIds = new Set((schedules ?? []).map((s) => s.site_id));

    const result = sites.map((site) => {
      const siteRuns = (runs ?? []).filter((r) => r.site_id === site.id); // already newest-first
      const latestRun = siteRuns[0] ?? null;
      const previousScore = siteRuns[1]?.score ?? null;
      const sparkline = siteRuns
        .slice(0, 8)
        .reverse()
        .map((r) => r.score ?? 0);
      const state: "monitored" | "not_monitored" | "never_run" = scheduledSiteIds.has(site.id)
        ? "monitored"
        : siteRuns.length > 0
          ? "not_monitored"
          : "never_run";

      return {
        id: site.id,
        url: site.url,
        label: site.label,
        latestRun: latestRun
          ? { id: latestRun.id, score: latestRun.score, completionRate: latestRun.completion_rate, finishedAt: latestRun.finished_at }
          : null,
        previousScore,
        sparkline,
        lastRunAt: latestRun?.finished_at ?? null,
        state,
      };
    });

    res.json({ sites: result });
  } catch (err) {
    next(err);
  }
});

sitesRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateSiteSchema.parse(req.body);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("sites")
      .insert({ user_id: req.userId!, url: body.url, label: body.label ?? null })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ site: data });
  } catch (err) {
    next(err);
  }
});

/** Screen 8: site meta + full run history + the site's schedule, if any. */
sitesRouter.get("/:id", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: site, error } = await supabase
      .from("sites")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();
    if (error || !site) return res.status(404).json({ error: "Site not found" });

    const [{ data: runs, error: runsError }, { data: schedule, error: scheduleError }, { data: alerts, error: alertsError }] =
      await Promise.all([
        supabase
          .from("runs")
          .select("id, score, completion_rate, status, goal, attempts_total, created_at, finished_at")
          .eq("site_id", site.id)
          .order("created_at", { ascending: false }),
        supabase.from("schedules").select("*").eq("site_id", site.id).maybeSingle(),
        // Most recent first — the "changes detected" banner only ever shows
        // the single latest drop, not a history of every alert ever fired.
        supabase.from("alerts").select("*").eq("site_id", site.id).order("triggered_at", { ascending: false }).limit(1),
      ]);
    if (runsError) throw runsError;
    if (scheduleError) throw scheduleError;
    if (alertsError) throw alertsError;

    res.json({ site, runs: runs ?? [], schedule: schedule ?? null, latestAlert: alerts?.[0] ?? null });
  } catch (err) {
    next(err);
  }
});

/**
 * Screen 8's alert settings panel. Upserts the site's schedule: if one
 * already exists, only its threshold/channels change; if not, creates one
 * with a default weekly cadence and no goal restriction — so setting an
 * alert threshold from the site-detail screen also turns monitoring on,
 * same as it would from Screen 9. (The recurring job that would actually
 * *act* on this doesn't exist yet — see routes/schedules.ts and the
 * Monitoring page's notice.)
 */
sitesRouter.put("/:id/alerts", async (req, res, next) => {
  try {
    const body = AlertsSchema.parse(req.body);
    const supabase = getSupabase();
    const { data: site, error } = await supabase
      .from("sites")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();
    if (error || !site) return res.status(404).json({ error: "Site not found" });

    const { data: existing } = await supabase.from("schedules").select("id").eq("site_id", site.id).maybeSingle();

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("schedules")
        .update({ alert_threshold: body.alertThreshold, alert_channels: body.alertChannels })
        .eq("id", existing.id)
        .select()
        .single();
      if (updateError) throw updateError;
      return res.json({ schedule: updated });
    }

    const { data: created, error: createError } = await supabase
      .from("schedules")
      .insert({
        site_id: site.id,
        user_id: req.userId!,
        cadence: "weekly",
        goals: [],
        alert_threshold: body.alertThreshold,
        alert_channels: body.alertChannels,
      })
      .select()
      .single();
    if (createError) throw createError;
    res.status(201).json({ schedule: created });
  } catch (err) {
    next(err);
  }
});
