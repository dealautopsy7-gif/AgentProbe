import { Router } from "express";
import { getSupabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

export const accountRouter = Router();
accountRouter.use(requireAuth);

/**
 * Requires the service-role client (admin.deleteUser) — can't be done from
 * the browser's anon-key client, hence a real backend route rather than a
 * direct supabase-js call from the frontend. Every table with a user_id FK
 * is `on delete cascade` (see 0001_init.sql and later migrations), so this
 * one call removes sites/runs/attempts/checkpoints/fixes/schedules/alerts/
 * user_plans for the user too — no manual cleanup needed here.
 */
accountRouter.delete("/", async (req, res, next) => {
  try {
    const { error } = await getSupabase().auth.admin.deleteUser(req.userId!);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
