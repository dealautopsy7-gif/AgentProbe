import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { getEnv } from "../config/env.js";
import { getSupabase } from "../lib/supabase.js";

/**
 * Verifies Stripe's signature scheme by hand (HMAC-SHA256 over
 * "timestamp.rawBody", per Stripe's documented algorithm) rather than
 * pulling in the Stripe SDK for one function — this endpoint is never
 * exercised until STRIPE_WEBHOOK_SECRET exists, so a heavy dependency
 * would be dead weight until then.
 */
function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(signature, "hex");
  return expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf);
}

interface StripeCheckoutSession {
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: { userId?: string; plan?: string };
}

/**
 * Route is mounted in index.ts BEFORE the global express.json() middleware
 * with its own express.raw() parser scoped to this path only — Stripe's
 * signature is computed over the exact raw request bytes, so a JSON-parsed
 * (re-serialized) body would never verify correctly.
 *
 * Genuinely inert without STRIPE_WEBHOOK_SECRET: answers 501 rather than
 * silently accepting unverifiable events. Once a real secret + checkout
 * flow exist, this updates user_plans directly from the event — no other
 * code change needed.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  const env = getEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return res.status(501).json({ error: "Stripe webhooks aren't configured yet." });
  }

  const signatureHeader = req.header("stripe-signature");
  const rawBody = req.body as Buffer;
  if (!signatureHeader || !Buffer.isBuffer(rawBody) || !verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event: { type?: string; data?: { object?: StripeCheckoutSession } };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const userId = session?.client_reference_id ?? session?.metadata?.userId;
    const plan = session?.metadata?.plan;
    if (userId && (plan === "pro" || plan === "agency")) {
      await getSupabase()
        .from("user_plans")
        .upsert({
          user_id: userId,
          plan,
          stripe_customer_id: session?.customer ?? null,
          stripe_subscription_id: session?.subscription ?? null,
        });
    }
  }

  res.json({ received: true });
}
