/**
 * One-off verification script (not part of the app) — creates a throwaway
 * confirmed test user via the Supabase Admin API, uses it to call the real
 * POST /runs endpoint, polls GET /runs/:id until the stub worker marks it
 * done, and prints what landed in the DB. Deletes the test user afterward.
 *
 * Run with: npx tsx scripts/verify-pipeline.ts
 */
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../src/config/env.js";

const API_BASE = `http://localhost:${process.env.PORT ?? 8787}`;

async function main() {
  const env = getEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const email = `pipeline-verify-${Date.now()}@agentprobe-test.local`;
  const password = "Verify-Pipeline-123!";

  console.log(`Creating confirmed test user: ${email}`);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) throw createError ?? new Error("createUser failed");

  try {
    const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) throw signInError ?? new Error("signIn failed");
    const token = signIn.session.access_token;
    console.log("Signed in, got access token.");

    console.log("\nPOST /runs …");
    const createRes = await fetch(`${API_BASE}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: "https://example-shop.test", goal: "Buy the cheapest in-stock item", attempts: 5 }),
    });
    const createBody = (await createRes.json()) as { runId: string; status: string };
    console.log(`  status ${createRes.status}:`, createBody);
    if (!createRes.ok) throw new Error("POST /runs failed");

    const runId = createBody.runId;
    console.log(`\nPolling GET /runs/${runId} until done…`);

    let finalRun: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`${API_BASE}/runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { run?: { status: string } };
      process.stdout.write(`  [${i}] status=${body.run?.status} `);
      if (body.run?.status === "done" || body.run?.status === "failed") {
        console.log("-> finished");
        finalRun = body;
        break;
      }
      console.log();
    }

    if (!finalRun) throw new Error("Run never reached done/failed within the poll window");

    console.log("\n--- Final run row ---");
    console.log(JSON.stringify(finalRun.run, null, 2));
    console.log(`\n--- Attempts (${finalRun.attempts.length}) ---`);
    for (const a of finalRun.attempts) {
      console.log(`  #${a.attempt_number} outcome=${a.outcome} stuck_reason=${a.stuck_reason ?? "-"} checkpoints=${a.checkpoints.map((c: any) => `${c.name}:${c.passed}`).join(", ")}`);
    }

    console.log("\nPIPELINE VERIFIED: POST /runs -> BullMQ job -> stub worker -> DB rows -> GET /runs/:id all round-tripped correctly.");
  } finally {
    console.log(`\nCleaning up test user ${created.user.id}…`);
    await admin.auth.admin.deleteUser(created.user.id);
  }
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
