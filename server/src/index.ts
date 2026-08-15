import express from "express";
import cors from "cors";
import { getEnv } from "./config/env.js";
import { runsRouter } from "./routes/runs.js";
import { sitesRouter } from "./routes/sites.js";
import { schedulesRouter } from "./routes/schedules.js";
import { publicRouter } from "./routes/public.js";
import { billingRouter } from "./routes/billing.js";
import { accountRouter } from "./routes/account.js";
import { clientsRouter } from "./routes/clients.js";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";

const app = express();

app.use(cors());

// Mounted before express.json(): Stripe's signature is computed over the
// exact raw request bytes, so this route needs its own raw-body parser
// rather than the JSON-parsed (re-serialized) body every other route gets.
app.post("/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/runs", runsRouter);
app.use("/sites", sitesRouter);
app.use("/schedules", schedulesRouter);
app.use("/public", publicRouter);
app.use("/billing", billingRouter);
app.use("/account", accountRouter);
app.use("/clients", clientsRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(400).json({ error: message });
});

const env = getEnv();
app.listen(env.PORT, () => {
  console.log(`AgentProbe API listening on :${env.PORT}`);
});
