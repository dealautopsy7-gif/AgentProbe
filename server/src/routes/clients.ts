import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

function generateSlug(): string {
  return randomBytes(6).toString("base64url"); // 8 URL-safe chars
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CreateClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brandColor: z.string().regex(HEX_COLOR).optional(),
});
const UpdateClientSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brandColor: z.string().regex(HEX_COLOR).nullable().optional(),
});
const AssignSiteSchema = z.object({ clientId: z.string().uuid().nullable() });

interface SiteSummary {
  id: string;
  url: string;
  label: string | null;
  latestScore: number | null;
  lastRunAt: string | null;
}

/**
 * Client list with sites grouped underneath, plus an "unassigned" bucket —
 * a site with no client_id is genuinely unassigned, not an error state, so
 * it gets its own honest group rather than being hidden.
 */
clientsRouter.get("/", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const userId = req.userId!;

    const [{ data: clients, error: clientsError }, { data: sites, error: sitesError }] = await Promise.all([
      supabase.from("clients").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("sites").select("id, url, label, client_id").eq("user_id", userId),
    ]);
    if (clientsError) throw clientsError;
    if (sitesError) throw sitesError;

    const siteIds = (sites ?? []).map((s) => s.id);
    let latestBySite = new Map<string, { score: number | null; finished_at: string | null }>();
    if (siteIds.length > 0) {
      const { data: runs, error: runsError } = await supabase
        .from("runs")
        .select("site_id, score, finished_at")
        .in("site_id", siteIds)
        .eq("status", "done")
        .order("finished_at", { ascending: false });
      if (runsError) throw runsError;
      for (const r of runs ?? []) {
        if (!latestBySite.has(r.site_id)) latestBySite.set(r.site_id, { score: r.score, finished_at: r.finished_at });
      }
    }

    const toSummary = (s: { id: string; url: string; label: string | null }): SiteSummary => {
      const latest = latestBySite.get(s.id);
      return { id: s.id, url: s.url, label: s.label, latestScore: latest?.score ?? null, lastRunAt: latest?.finished_at ?? null };
    };

    const clientResults = (clients ?? []).map((c) => {
      const clientSites = (sites ?? []).filter((s) => s.client_id === c.id).map(toSummary);
      const scored = clientSites.filter((s) => s.latestScore !== null);
      const averageScore = scored.length > 0 ? Math.round(scored.reduce((sum, s) => sum + (s.latestScore ?? 0), 0) / scored.length) : null;
      return { id: c.id, name: c.name, brandColor: c.brand_color, created_at: c.created_at, sites: clientSites, averageScore };
    });

    const unassignedSites = (sites ?? []).filter((s) => !s.client_id).map(toSummary);

    res.json({ clients: clientResults, unassignedSites });
  } catch (err) {
    next(err);
  }
});

clientsRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateClientSchema.parse(req.body);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("clients")
      .insert({ user_id: req.userId!, name: body.name, brand_color: body.brandColor ?? null })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ client: data });
  } catch (err) {
    next(err);
  }
});

clientsRouter.put("/:id", async (req, res, next) => {
  try {
    const body = UpdateClientSchema.parse(req.body);
    const supabase = getSupabase();
    const update: { name?: string; brand_color?: string | null } = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.brandColor !== undefined) update.brand_color = body.brandColor;

    const { data, error } = await supabase
      .from("clients")
      .update(update)
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: "Client not found" });
    res.json({ client: data });
  } catch (err) {
    next(err);
  }
});

clientsRouter.delete("/:id", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("clients").delete().eq("id", req.params.id).eq("user_id", req.userId!);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Moves a site in/out of a client group; clientId: null unassigns it. */
clientsRouter.put("/sites/:siteId", async (req, res, next) => {
  try {
    const body = AssignSiteSchema.parse(req.body);
    const supabase = getSupabase();

    if (body.clientId) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", body.clientId)
        .eq("user_id", req.userId!)
        .maybeSingle();
      if (clientError) throw clientError;
      if (!client) return res.status(404).json({ error: "Client not found" });
    }

    const { data: site, error } = await supabase
      .from("sites")
      .update({ client_id: body.clientId })
      .eq("id", req.params.siteId)
      .eq("user_id", req.userId!)
      .select()
      .single();
    if (error || !site) return res.status(404).json({ error: "Site not found" });
    res.json({ site });
  } catch (err) {
    next(err);
  }
});

/**
 * Generates a public, branded report link for a client — real HTML content
 * (see routes/public.ts + views/publicClientReportPage.ts), rendered live
 * from current data at view time rather than a frozen snapshot, same model
 * as the run share page. Gated to the Agency plan server-side, not just
 * hidden in the UI: a Free/Pro user hitting this endpoint directly gets a
 * genuine 403, not a silently-generated link.
 */
clientsRouter.post("/:id/report", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const userId = req.userId!;

    const { data: planRow } = await supabase.from("user_plans").select("plan").eq("user_id", userId).maybeSingle();
    if ((planRow?.plan ?? "free") !== "agency") {
      return res.status(403).json({ error: "White-labeled reports are an Agency-plan feature. Upgrade to generate one." });
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return res.status(404).json({ error: "Client not found" });

    const slug = generateSlug();
    const { data: report, error: reportError } = await supabase
      .from("client_reports")
      .insert({ client_id: client.id, user_id: userId, slug })
      .select()
      .single();
    if (reportError || !report) throw reportError ?? new Error("Failed to create report");

    res.status(201).json({ slug: report.slug });
  } catch (err) {
    next(err);
  }
});
