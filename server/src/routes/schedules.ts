import { Router } from "express";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import type { Database } from "../types/db.js";

type ScheduleUpdate = Database["public"]["Tables"]["schedules"]["Update"];

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth);

const CreateScheduleSchema = z.object({
  siteId: z.string().uuid(),
  cadence: z.enum(["daily", "weekly"]),
  goals: z.array(z.string()).default([]),
  alertThreshold: z.number().int().min(1).max(100).default(10),
  alertChannels: z.array(z.enum(["email"])).default(["email"]),
});

const UpdateScheduleSchema = CreateScheduleSchema.omit({ siteId: true }).partial();

/** Screen 9: every schedule for the user, with the site's label/url for display. */
schedulesRouter.get("/", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!schedules || schedules.length === 0) return res.json({ schedules: [] });

    const siteIds = [...new Set(schedules.map((s) => s.site_id))];
    const { data: sites, error: sitesError } = await supabase.from("sites").select("id, url, label").in("id", siteIds);
    if (sitesError) throw sitesError;
    const siteById = new Map((sites ?? []).map((s) => [s.id, s]));

    res.json({
      schedules: schedules.map((s) => ({ ...s, site: siteById.get(s.site_id) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

schedulesRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateScheduleSchema.parse(req.body);
    const supabase = getSupabase();

    // Ownership check — a schedule can only be created for a site this user owns.
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id")
      .eq("id", body.siteId)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (siteError) throw siteError;
    if (!site) return res.status(404).json({ error: "Site not found" });

    const { data, error } = await supabase
      .from("schedules")
      .insert({
        site_id: body.siteId,
        user_id: req.userId!,
        cadence: body.cadence,
        goals: body.goals,
        alert_threshold: body.alertThreshold,
        alert_channels: body.alertChannels,
      })
      .select()
      .single();

    if (error) {
      // schedules_site_id_unique — one monitoring config per site.
      if (error.code === "23505") return res.status(409).json({ error: "This site already has a monitoring schedule" });
      throw error;
    }
    res.status(201).json({ schedule: data });
  } catch (err) {
    next(err);
  }
});

schedulesRouter.put("/:id", async (req, res, next) => {
  try {
    const body = UpdateScheduleSchema.parse(req.body);
    const supabase = getSupabase();
    const update: ScheduleUpdate = {};
    if (body.cadence !== undefined) update.cadence = body.cadence;
    if (body.goals !== undefined) update.goals = body.goals;
    if (body.alertThreshold !== undefined) update.alert_threshold = body.alertThreshold;
    if (body.alertChannels !== undefined) update.alert_channels = body.alertChannels;

    const { data, error } = await supabase
      .from("schedules")
      .update(update)
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Schedule not found" });
    res.json({ schedule: data });
  } catch (err) {
    next(err);
  }
});

/** Turning monitoring off — deletes the schedule rather than a fabricated "paused" flag. */
schedulesRouter.delete("/:id", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from("schedules")
      .delete({ count: "exact" })
      .eq("id", req.params.id)
      .eq("user_id", req.userId!);
    if (error) throw error;
    if (!count) return res.status(404).json({ error: "Schedule not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
