import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { getRunQueue } from "../lib/queue.js";
import { requireAuth } from "../middleware/auth.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import type { PlanTier } from "../types/db.js";

function generateSlug(): string {
  return randomBytes(6).toString("base64url"); // 8 URL-safe chars
}

export const runsRouter = Router();
runsRouter.use(requireAuth);

const CreateRunSchema = z.object({
  url: z.string().url(),
  goal: z.string().min(1),
  attempts: z.number().int().min(1).max(10).default(5),
});

async function findSite(userId: string, url: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("sites").select("*").eq("user_id", userId).eq("url", url).maybeSingle();
  if (error) throw error;
  return data;
}

async function createSite(userId: string, url: string) {
  const supabase = getSupabase();
  const label = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  const { data: created, error: createError } = await supabase
    .from("sites")
    .insert({ user_id: userId, url, label })
    .select()
    .single();
  if (createError || !created) throw createError ?? new Error("Failed to create site");
  return created;
}

class UpgradeRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeRequiredError";
  }
}

/**
 * The free-tier gate that was previously a TODO. Checked server-side, not
 * just reflected in the UI — a client can't bypass it by skipping the
 * Billing page. Two independent caps, both plan-driven so Billing's display
 * and this enforcement can never silently drift apart (see lib/plans.ts):
 * a lifetime run cap (Free's "1 test") and a site-count cap (Free/Pro), each
 * only checked when it would actually apply (an existing site's repeat run
 * never trips the site cap; unlimited plans skip both checks entirely).
 */
async function assertWithinPlanLimits(userId: string, isNewSite: boolean): Promise<void> {
  const supabase = getSupabase();
  const { data: planRow } = await supabase.from("user_plans").select("plan").eq("user_id", userId).maybeSingle();
  const plan: PlanTier = planRow?.plan ?? "free";
  const limits = PLAN_LIMITS[plan];

  if (limits.runs !== null) {
    const { count } = await supabase.from("runs").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= limits.runs) {
      throw new UpgradeRequiredError(
        `The ${limits.label} plan includes ${limits.runs} test${limits.runs === 1 ? "" : "s"}. Upgrade to run more.`,
      );
    }
  }

  if (isNewSite && limits.sites !== null) {
    const { count } = await supabase.from("sites").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= limits.sites) {
      throw new UpgradeRequiredError(
        `The ${limits.label} plan includes ${limits.sites} site${limits.sites === 1 ? "" : "s"}. Upgrade to add more.`,
      );
    }
  }
}

runsRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateRunSchema.parse(req.body);
    const userId = req.userId!;
    const supabase = getSupabase();

    const existingSite = await findSite(userId, body.url);
    await assertWithinPlanLimits(userId, !existingSite);
    const site = existingSite ?? (await createSite(userId, body.url));

    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        site_id: site.id,
        user_id: userId,
        goal: body.goal,
        status: "queued",
        attempts_total: body.attempts,
      })
      .select()
      .single();

    if (error || !run) throw error ?? new Error("Failed to create run");

    const job = await getRunQueue().add("run-agent-attempt", {
      runId: run.id,
      siteId: site.id,
      userId,
      url: body.url,
      goal: body.goal,
      attempts: body.attempts,
      source: "manual",
    });

    // Stored so POST /:id/cancel can remove the job outright while it's
    // still queued (an active job can't be force-killed from outside —
    // see runWorker.ts's cooperative status check instead).
    if (job.id) await supabase.from("runs").update({ bullmq_job_id: job.id }).eq("id", run.id);

    res.status(201).json({ runId: run.id, status: run.status });
  } catch (err) {
    if (err instanceof UpgradeRequiredError) {
      return res.status(402).json({ error: err.message });
    }
    next(err);
  }
});

runsRouter.get("/:id", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: run, error } = await supabase
      .from("runs")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();
    if (error || !run) return res.status(404).json({ error: "Run not found" });

    const [{ data: attempts }, { data: fixes }, { data: site }] = await Promise.all([
      supabase
        .from("attempts")
        .select("*, checkpoints(*), run_steps(*)")
        .eq("run_id", run.id)
        .order("attempt_number"),
      supabase.from("fixes").select("*").eq("run_id", run.id),
      supabase.from("sites").select("url, label").eq("id", run.site_id).maybeSingle(),
    ]);

    res.json({ run, attempts: attempts ?? [], fixes: fixes ?? [], site: site ?? null });
  } catch (err) {
    next(err);
  }
});

/**
 * Real cancellation, not just the frontend navigating away. A still-queued
 * job is removed outright so it never starts. A job already RUNNING can't
 * be force-killed from outside BullMQ — instead this sets runs.status to
 * 'cancelled' immediately, and the worker checks that between every
 * step/attempt (runWorker.ts) and stops cooperatively, leaving the status
 * as 'cancelled' rather than overwriting it with 'done'/'failed'.
 */
runsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: run, error } = await supabase
      .from("runs")
      .select("id, status, bullmq_job_id")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();
    if (error || !run) return res.status(404).json({ error: "Run not found" });

    if (run.status === "done" || run.status === "failed" || run.status === "cancelled") {
      return res.status(409).json({ error: `Run already ${run.status}, nothing to cancel` });
    }

    if (run.bullmq_job_id) {
      const job = await getRunQueue().getJob(run.bullmq_job_id);
      // remove() only succeeds while the job hasn't started processing yet;
      // an active job throws/no-ops here, which is fine — the status flag
      // below is what actually stops it in that case.
      await job?.remove().catch(() => undefined);
    }

    const { data: updated, error: updateError } = await supabase
      .from("runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", run.id)
      .select()
      .single();
    if (updateError) throw updateError;

    res.json({ run: updated });
  } catch (err) {
    next(err);
  }
});

runsRouter.post("/:id/share", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: run, error } = await supabase
      .from("runs")
      .select("id, is_public, public_slug")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();
    if (error || !run) return res.status(404).json({ error: "Run not found" });

    // Idempotent: re-sharing an already-public run just returns its existing slug.
    const slug = run.public_slug ?? generateSlug();
    if (!run.is_public || !run.public_slug) {
      const { error: updateError } = await supabase.from("runs").update({ is_public: true, public_slug: slug }).eq("id", run.id);
      if (updateError) throw updateError;
    }

    res.json({ slug });
  } catch (err) {
    next(err);
  }
});

runsRouter.get("/:id/video", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: attempt, error } = await supabase
      .from("attempts")
      .select("video_path")
      .eq("run_id", req.params.id)
      .not("video_path", "is", null)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !attempt?.video_path) return res.status(404).json({ error: "No video available for this run" });

    const { data: signed, error: signError } = await supabase.storage
      .from(process.env.VIDEO_STORAGE_BUCKET ?? "run-videos")
      .createSignedUrl(attempt.video_path, 60 * 60);

    if (signError || !signed) throw signError ?? new Error("Failed to sign video URL");

    res.json({ url: signed.signedUrl });
  } catch (err) {
    next(err);
  }
});
