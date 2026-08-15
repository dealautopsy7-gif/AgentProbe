import { Router } from "express";
import { getSupabase, getSupabasePublic } from "../lib/supabase.js";
import { getEnv } from "../config/env.js";
import { CHECKPOINT_DEFINITIONS } from "../agent/checkpoints.js";
import { renderPublicRunPage, renderNotFoundPage, type PublicRunView } from "../views/publicRunPage.js";
import { renderClientReportPage, type PublicClientReportView } from "../views/publicClientReportPage.js";

export const publicRouter = Router();

/**
 * Landing page (Screen 1): up to 3 recent public runs. Only fields safe to
 * expose to anonymous visitors — no fix list, no account/site-owner info.
 *
 * Uses the anon-key client, not the service-role one: row visibility here
 * is enforced by the `runs_select_public` / `sites_select_via_public_run`
 * RLS policies (an anon/publishable-key query only ever sees is_public=true
 * rows), not solely by the `.eq('is_public', true)` filters below — those
 * stay as an explicit, readable second layer, not the only one.
 */
publicRouter.get("/samples", async (_req, res, next) => {
  try {
    const supabase = getSupabasePublic();

    const { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("id, site_id, score, completion_rate")
      .eq("is_public", true)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(3);

    if (runsError) throw runsError;
    if (!runs || runs.length === 0) return res.json({ samples: [] });

    const siteIds = [...new Set(runs.map((r) => r.site_id))];
    const { data: sites, error: sitesError } = await supabase.from("sites").select("id, url, label").in("id", siteIds);
    if (sitesError) throw sitesError;
    const siteById = new Map((sites ?? []).map((s) => [s.id, s]));

    const runIds = runs.map((r) => r.id);
    const { data: attempts, error: attemptsError } = await supabase
      .from("attempts")
      .select("run_id, outcome")
      .in("run_id", runIds);
    if (attemptsError) throw attemptsError;

    const samples = runs.map((run) => {
      const site = siteById.get(run.site_id);
      const runAttempts = (attempts ?? []).filter((a) => a.run_id === run.id);
      const successCount = runAttempts.filter((a) => a.outcome === "success").length;

      return {
        siteLabel: site?.label || (site?.url ? new URL(site.url).hostname : "a store"),
        score: run.score ?? 0,
        attempts: runAttempts.length,
        summary:
          runAttempts.length > 0
            ? `${successCount} of ${runAttempts.length} attempts reached checkout.`
            : "Completion rate not yet available.",
      };
    });

    res.json({ samples });
  } catch (err) {
    next(err);
  }
});

/**
 * Public shareable result (Screen 6). Server-rendered HTML by default (this
 * is the canonical page a share link points at — OG tags and content need
 * to be there without client JS running, for social crawlers and no-JS
 * clients alike); returns JSON instead if the request explicitly prefers it
 * (Accept: application/json), for programmatic use.
 *
 * Anon-key client throughout: whether a stranger can see this run is a
 * question the database answers via RLS, not a question this handler's
 * `.eq('public_slug', ...)` filter answers alone.
 */
publicRouter.get("/runs/:slug", async (req, res, next) => {
  try {
    const supabase = getSupabasePublic();
    const env = getEnv();
    const canonicalUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const wantsJson = req.accepts(["html", "json"]) === "json";

    const { data: run } = await supabase
      .from("runs")
      .select("id, site_id, score, completion_rate, attempts_total")
      .eq("public_slug", req.params.slug)
      .eq("is_public", true)
      .maybeSingle();

    if (!run) {
      if (wantsJson) return res.status(404).json({ error: "Not found" });
      return res.status(404).type("html").send(renderNotFoundPage(env.FRONTEND_URL));
    }

    const [{ data: site }, { data: attempts }] = await Promise.all([
      supabase.from("sites").select("url, label").eq("id", run.site_id).maybeSingle(),
      supabase.from("attempts").select("id, attempt_number, outcome, video_path").eq("run_id", run.id).order("attempt_number"),
    ]);

    const attemptIds = (attempts ?? []).map((a) => a.id);
    const { data: checkpoints } =
      attemptIds.length > 0
        ? await supabase.from("checkpoints").select("attempt_id, name, passed").in("attempt_id", attemptIds)
        : { data: [] as { attempt_id: string; name: string; passed: boolean | null }[] };

    const lastAttempt = (attempts ?? []).at(-1);
    const lastCheckpoints = (checkpoints ?? []).filter((c) => c.attempt_id === lastAttempt?.id);
    const successCount = (attempts ?? []).filter((a) => a.outcome === "success").length;

    let videoUrl: string | null = null;
    if (lastAttempt?.video_path) {
      // Storage signing needs the service-role client even for a public run —
      // that's a narrow, separate operation from the RLS-gated row reads
      // above, not a way around them (we only reach here once the anon
      // client has already proven this row is genuinely public).
      const { data: signed } = await getSupabase()
        .storage.from(env.VIDEO_STORAGE_BUCKET)
        .createSignedUrl(lastAttempt.video_path, 60 * 60);
      videoUrl = signed?.signedUrl ?? null;
    }

    const view: PublicRunView = {
      siteLabel: site?.label || (site?.url ? new URL(site.url).hostname : "a store"),
      score: run.score,
      completionRate: run.completion_rate,
      attemptsTotal: run.attempts_total,
      successCount,
      attempts: attempts?.length ?? 0,
      checkpoints: CHECKPOINT_DEFINITIONS.map((def) => ({
        name: def.name,
        label: def.label,
        passed: lastCheckpoints.find((c) => c.name === def.name)?.passed ?? null,
      })),
      videoUrl,
    };

    if (wantsJson) return res.json(view);
    res.type("html").send(renderPublicRunPage(view, canonicalUrl, env.FRONTEND_URL));
  } catch (err) {
    next(err);
  }
});

/**
 * Screen 10's white-labeled client report. Anon-key client throughout, same
 * discipline as the run share page above: whether a stranger can see this
 * client's sites/runs/fixes is answered by the RLS chain added in migration
 * 0010 (clients/sites/runs/fixes each "select via client_report"), not by
 * an app-level filter that could drift out of sync with what's actually
 * gated. Rendered live from current data — see publicClientReportPage.ts.
 */
publicRouter.get("/reports/:slug", async (req, res, next) => {
  try {
    const supabase = getSupabasePublic();
    const env = getEnv();
    const canonicalUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const wantsJson = req.accepts(["html", "json"]) === "json";

    const { data: report } = await supabase.from("client_reports").select("client_id").eq("slug", req.params.slug).maybeSingle();
    if (!report) {
      if (wantsJson) return res.status(404).json({ error: "Not found" });
      return res.status(404).type("html").send(renderNotFoundPage(env.FRONTEND_URL));
    }

    const { data: client } = await supabase.from("clients").select("name, brand_color").eq("id", report.client_id).maybeSingle();
    if (!client) {
      if (wantsJson) return res.status(404).json({ error: "Not found" });
      return res.status(404).type("html").send(renderNotFoundPage(env.FRONTEND_URL));
    }

    const { data: sites } = await supabase.from("sites").select("id, url, label").eq("client_id", report.client_id);
    const siteIds = (sites ?? []).map((s) => s.id);

    let latestRunBySite = new Map<string, { id: string; score: number | null }>();
    if (siteIds.length > 0) {
      const { data: runs } = await supabase
        .from("runs")
        .select("id, site_id, score, finished_at")
        .in("site_id", siteIds)
        .eq("status", "done")
        .order("finished_at", { ascending: false });
      for (const r of runs ?? []) {
        if (!latestRunBySite.has(r.site_id)) latestRunBySite.set(r.site_id, { id: r.id, score: r.score });
      }
    }

    const latestRunIds = [...latestRunBySite.values()].map((r) => r.id);
    let fixesByRun = new Map<string, { severity: "critical" | "high" | "medium"; problem: string; likely_cause: string | null; suggested_fix: string }[]>();
    if (latestRunIds.length > 0) {
      const { data: fixes } = await supabase.from("fixes").select("run_id, severity, problem, likely_cause, suggested_fix").in("run_id", latestRunIds);
      for (const f of fixes ?? []) {
        const list = fixesByRun.get(f.run_id) ?? [];
        list.push(f);
        fixesByRun.set(f.run_id, list);
      }
    }

    const siteViews = (sites ?? []).map((s) => {
      const latest = latestRunBySite.get(s.id);
      const fixes = latest ? (fixesByRun.get(latest.id) ?? []) : [];
      return {
        label: s.label || (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })(),
        url: s.url,
        latestScore: latest?.score ?? null,
        fixes: fixes.map((f) => ({ severity: f.severity, problem: f.problem, likelyCause: f.likely_cause, suggestedFix: f.suggested_fix })),
      };
    });

    const scored = siteViews.filter((s) => s.latestScore !== null);
    const averageScore = scored.length > 0 ? Math.round(scored.reduce((sum, s) => sum + (s.latestScore ?? 0), 0) / scored.length) : null;

    const view: PublicClientReportView = {
      clientName: client.name,
      brandColor: client.brand_color,
      averageScore,
      sites: siteViews,
    };

    if (wantsJson) return res.json(view);
    res.type("html").send(renderClientReportPage(view, canonicalUrl, env.FRONTEND_URL));
  } catch (err) {
    next(err);
  }
});
