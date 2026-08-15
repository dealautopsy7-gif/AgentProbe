import { Router } from "express";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { getEnv } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import type { PlanTier } from "../types/db.js";

export const billingRouter = Router();
billingRouter.use(requireAuth);

/**
 * No plan/usage data is fabricated here: a user with no user_plans row is
 * genuinely on 'free' (that's the whole point of the table only gaining a
 * row on upgrade — see 0008's migration comment), and usage counts are
 * live queries, not estimates.
 */
billingRouter.get("/", async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const userId = req.userId!;

    const { data: planRow } = await supabase.from("user_plans").select("plan").eq("user_id", userId).maybeSingle();
    const plan: PlanTier = planRow?.plan ?? "free";

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [{ count: siteCount }, { count: runsThisMonth }] = await Promise.all([
      supabase.from("sites").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("runs").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", startOfMonth.toISOString()),
    ]);

    res.json({
      plan,
      limits: PLAN_LIMITS,
      usage: {
        sites: siteCount ?? 0,
        runsThisMonth: runsThisMonth ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

const CheckoutSchema = z.object({ plan: z.enum(["pro", "agency"]) });

/**
 * Real Stripe Checkout Session creation via raw REST (no SDK dependency —
 * Stripe's API is plain form-encoded POST) — but entirely inert until
 * STRIPE_SECRET_KEY + a price id for the requested plan exist. Until then
 * this always answers honestly with 501, never a fake success. The point of
 * writing the real call now is that adding the key later requires zero code
 * changes here, same principle as the AgentDriver/BrowserProvider swap.
 */
billingRouter.post("/checkout", async (req, res, next) => {
  try {
    const { plan } = CheckoutSchema.parse(req.body);
    const env = getEnv();

    if (!env.STRIPE_SECRET_KEY) {
      return res.status(501).json({ error: "Stripe checkout isn't wired up yet." });
    }
    const priceId = plan === "pro" ? env.STRIPE_PRICE_ID_PRO : env.STRIPE_PRICE_ID_AGENCY;
    if (!priceId) {
      return res.status(501).json({ error: `No Stripe price is configured for the ${plan} plan yet.` });
    }

    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${env.FRONTEND_URL}/billing?checkout=success`,
      cancel_url: `${env.FRONTEND_URL}/billing?checkout=cancelled`,
      client_reference_id: req.userId!,
      "metadata[plan]": plan,
      "metadata[userId]": req.userId!,
    });

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = (await stripeRes.json()) as { url?: string; error?: { message?: string } };
    if (!stripeRes.ok || !data.url) throw new Error(data.error?.message ?? "Stripe checkout session creation failed");

    res.json({ url: data.url });
  } catch (err) {
    next(err);
  }
});
