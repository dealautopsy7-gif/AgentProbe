const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export interface PublicSample {
  siteLabel: string;
  score: number;
  attempts: number;
  summary: string;
}

/**
 * Public samples for the landing page. The API/worker aren't wired up with
 * live credentials yet (see server/README.md), so a fetch failure here is
 * expected during early setup — callers should treat it the same as "no
 * public results yet" rather than surfacing a scary error.
 */
export async function fetchPublicSamples(): Promise<PublicSample[]> {
  const res = await fetch(`${API_BASE_URL}/public/samples`);
  if (!res.ok) throw new Error(`Failed to fetch public samples: ${res.status}`);
  const data = await res.json();
  return data.samples ?? [];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Creates a real run (POST /runs → DB row + BullMQ job). Requires a live
 * Supabase session — pass its access_token as the bearer credential.
 */
export async function createRun(
  accessToken: string,
  body: { url: string; goal: string; attempts: number },
): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE_URL}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? `Failed to create run: ${res.status}`, res.status);
  }
  return data;
}

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type AttemptOutcome = "success" | "fail" | "blocked";
export type CheckpointName =
  | "reached_listing"
  | "reached_pdp"
  | "price_legible"
  | "stock_determinable"
  | "added_to_cart"
  | "reached_checkout";

export interface RunRow {
  id: string;
  site_id: string;
  user_id: string;
  goal: string;
  status: RunStatus;
  score: number | null;
  completion_rate: number | null;
  cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  attempts_total: number | null;
}

export interface CheckpointRow {
  id: string;
  attempt_id: string;
  name: CheckpointName;
  passed: boolean | null;
  reason: string | null;
}

export interface RunStepRow {
  id: string;
  attempt_id: string;
  step_number: number;
  action: string;
  agent_reasoning: string | null;
  timestamp: string;
}

export interface AttemptRow {
  id: string;
  run_id: string;
  attempt_number: number;
  outcome: AttemptOutcome | null;
  stuck_reason: string | null;
  video_path: string | null;
  created_at: string;
  checkpoints: CheckpointRow[];
  run_steps: RunStepRow[];
}

export interface FixRow {
  id: string;
  run_id: string;
  severity: "critical" | "high" | "medium";
  problem: string;
  likely_cause: string | null;
  suggested_fix: string;
}

export interface FullRun {
  run: RunRow;
  attempts: AttemptRow[];
  fixes: FixRow[];
  site: { url: string; label: string | null } | null;
}

export async function fetchRun(accessToken: string, runId: string): Promise<FullRun> {
  const res = await fetch(`${API_BASE_URL}/runs/${runId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(`Failed to fetch run: ${res.status}`, res.status);
  return res.json();
}

/**
 * Only ever succeeds for a real live-mode run with a real recorded clip —
 * 404s honestly (caught by the caller) for stub-mode runs, which never
 * produce one.
 */
export async function fetchRunVideoUrl(accessToken: string, runId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/runs/${runId}/video`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(`No video available: ${res.status}`, res.status);
  return res.json();
}

/**
 * Marks a run public (idempotent — re-sharing an already-public run just
 * returns its existing slug) and returns the slug for building the public
 * URL. The public page itself is server-rendered by the API
 * (GET {API_BASE_URL}/public/runs/:slug) — not a route in this SPA — so
 * OG tags and content are there for social crawlers with no client JS.
 */
export async function shareRun(accessToken: string, runId: string): Promise<{ slug: string }> {
  const res = await fetch(`${API_BASE_URL}/runs/${runId}/share`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Failed to share run: ${res.status}`, res.status);
  return data;
}

export function publicRunUrl(slug: string): string {
  return `${API_BASE_URL}/public/runs/${slug}`;
}

/**
 * Real cancellation — removes the BullMQ job if still queued, and flips
 * runs.status to 'cancelled' immediately so the worker's cooperative check
 * (between steps/attempts) stops it even if it's already running.
 */
export async function cancelRun(accessToken: string, runId: string): Promise<void> {
  await authFetch(accessToken, `/runs/${runId}/cancel`, { method: "POST" });
}

async function authFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed: ${res.status}`, res.status);
  return data;
}

export type MonitoringState = "monitored" | "not_monitored" | "never_run";

export interface DashboardSite {
  id: string;
  url: string;
  label: string | null;
  latestRun: { id: string; score: number | null; completionRate: number | null; finishedAt: string | null } | null;
  previousScore: number | null;
  sparkline: number[];
  lastRunAt: string | null;
  state: MonitoringState;
}

export async function fetchSites(accessToken: string): Promise<DashboardSite[]> {
  const data = await authFetch(accessToken, "/sites");
  return data.sites ?? [];
}

export interface SiteRunSummary {
  id: string;
  score: number | null;
  completion_rate: number | null;
  status: RunStatus;
  goal: string;
  attempts_total: number | null;
  created_at: string;
  finished_at: string | null;
}

export type AlertChannel = "email";
export type Cadence = "daily" | "weekly";

export interface ScheduleRow {
  id: string;
  site_id: string;
  user_id: string;
  cadence: Cadence;
  goals: string[];
  alert_threshold: number;
  alert_channels: AlertChannel[];
  created_at: string;
}

export interface AlertRow {
  id: string;
  site_id: string;
  user_id: string;
  triggered_at: string;
  old_score: number | null;
  new_score: number | null;
  delivered: boolean;
}

export interface SiteDetail {
  site: { id: string; url: string; label: string | null; created_at: string };
  runs: SiteRunSummary[];
  schedule: ScheduleRow | null;
  latestAlert: AlertRow | null;
}

export async function fetchSiteDetail(accessToken: string, siteId: string): Promise<SiteDetail> {
  return authFetch(accessToken, `/sites/${siteId}`);
}

export async function updateSiteAlerts(
  accessToken: string,
  siteId: string,
  body: { alertThreshold: number; alertChannels: AlertChannel[] },
): Promise<{ schedule: ScheduleRow }> {
  return authFetch(accessToken, `/sites/${siteId}/alerts`, { method: "PUT", body: JSON.stringify(body) });
}

export interface ScheduleWithSite extends ScheduleRow {
  site: { url: string; label: string | null } | null;
}

export async function fetchSchedules(accessToken: string): Promise<ScheduleWithSite[]> {
  const data = await authFetch(accessToken, "/schedules");
  return data.schedules ?? [];
}

export async function createSchedule(
  accessToken: string,
  body: { siteId: string; cadence: Cadence; goals: string[]; alertThreshold: number; alertChannels: AlertChannel[] },
): Promise<{ schedule: ScheduleRow }> {
  return authFetch(accessToken, "/schedules", { method: "POST", body: JSON.stringify(body) });
}

export async function updateSchedule(
  accessToken: string,
  scheduleId: string,
  body: Partial<{ cadence: Cadence; goals: string[]; alertThreshold: number; alertChannels: AlertChannel[] }>,
): Promise<{ schedule: ScheduleRow }> {
  return authFetch(accessToken, `/schedules/${scheduleId}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteSchedule(accessToken: string, scheduleId: string): Promise<void> {
  await authFetch(accessToken, `/schedules/${scheduleId}`, { method: "DELETE" });
}

export type PlanTier = "free" | "pro" | "agency";

export interface PlanLimit {
  sites: number | null;
  runs: number | null;
  label: string;
  priceUsd: number;
}

export interface BillingInfo {
  plan: PlanTier;
  limits: Record<PlanTier, PlanLimit>;
  usage: { sites: number; runsThisMonth: number };
}

export async function fetchBilling(accessToken: string): Promise<BillingInfo> {
  return authFetch(accessToken, "/billing");
}

/**
 * Real call to a real endpoint — but until STRIPE_SECRET_KEY exists
 * server-side, this always resolves with a 501 ApiError carrying an honest
 * "not wired up yet" message rather than a fake checkout URL.
 */
export async function startCheckout(accessToken: string, plan: "pro" | "agency"): Promise<{ url: string }> {
  return authFetch(accessToken, "/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
}

/**
 * Requires the backend (service-role admin.deleteUser) — the browser's
 * anon-key client can't delete auth users. Cascades sites/runs/etc via FK
 * `on delete cascade`, so no other cleanup calls are needed here.
 */
export async function deleteAccount(accessToken: string): Promise<void> {
  await authFetch(accessToken, "/account", { method: "DELETE" });
}

export interface ClientSiteSummary {
  id: string;
  url: string;
  label: string | null;
  latestScore: number | null;
  lastRunAt: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  brandColor: string | null;
  created_at: string;
  sites: ClientSiteSummary[];
  averageScore: number | null;
}

export interface ClientsResponse {
  clients: ClientRow[];
  unassignedSites: ClientSiteSummary[];
}

export async function fetchClients(accessToken: string): Promise<ClientsResponse> {
  return authFetch(accessToken, "/clients");
}

export async function addClient(accessToken: string, name: string): Promise<{ client: ClientRow }> {
  return authFetch(accessToken, "/clients", { method: "POST", body: JSON.stringify({ name }) });
}

export async function deleteClient(accessToken: string, clientId: string): Promise<void> {
  await authFetch(accessToken, `/clients/${clientId}`, { method: "DELETE" });
}

export async function assignSiteToClient(accessToken: string, siteId: string, clientId: string | null): Promise<void> {
  await authFetch(accessToken, `/clients/sites/${siteId}`, { method: "PUT", body: JSON.stringify({ clientId }) });
}

export async function updateClientBrand(accessToken: string, clientId: string, brandColor: string | null): Promise<{ client: ClientRow }> {
  return authFetch(accessToken, `/clients/${clientId}`, { method: "PUT", body: JSON.stringify({ brandColor }) });
}

/**
 * Real call to a real, RLS-backed public page — but the server returns a
 * genuine 403 (not a fake link) unless the caller's plan is Agency. See
 * routes/clients.ts's server-side gate.
 */
export async function generateClientReport(accessToken: string, clientId: string): Promise<{ slug: string }> {
  return authFetch(accessToken, `/clients/${clientId}/report`, { method: "POST" });
}

export function publicReportUrl(slug: string): string {
  return `${API_BASE_URL}/public/reports/${slug}`;
}
