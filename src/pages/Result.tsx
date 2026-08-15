import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useTestConfig } from "../context/TestConfigContext";
import { fetchRun, fetchRunVideoUrl, shareRun, publicRunUrl, type AttemptRow } from "../lib/api";
import { CHECKPOINT_RAIL } from "../lib/checkpoints";

type CpStatus = "pass" | "fail" | "pending";

function StatusIcon({ status }: { status: CpStatus }) {
  if (status === "pass")
    return (
      <svg width="17" height="17" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="#30A46C" />
        <path d="M4.6 8.2l2.3 2.3L11.4 6" stroke="#30A46C" strokeWidth="1.5" fill="none" />
      </svg>
    );
  if (status === "fail")
    return (
      <svg width="17" height="17" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="#E5484D" />
        <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#E5484D" strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg width="17" height="17" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="none" stroke="rgba(233,233,237,.3)" />
    </svg>
  );
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const seconds = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Last attempt is the most representative single narrative for the checkpoint breakdown. */
function latestAttempt(attempts: AttemptRow[]): AttemptRow | undefined {
  return [...attempts].sort((a, b) => a.attempt_number - b.attempt_number).at(-1);
}

export function Result() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const { runId: contextRunId, siteUrl: contextSiteUrl } = useTestConfig();
  // A run-history row (Screen 8) links here with ?runId= to view any past
  // run, not just the one just completed — falls back to the context's
  // runId for the normal LiveRun -> Result handoff.
  const runId = searchParams.get("runId") ?? contextRunId;
  const [displayScore, setDisplayScore] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function handleShare() {
    if (!session || !runId) return;
    setSharing(true);
    setShareError(null);
    try {
      const { slug } = await shareRun(session.access_token, runId);
      window.open(publicRunUrl(slug), "_blank", "noopener");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to share this run");
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    if (!runId) navigate("/new-test", { replace: true });
  }, [runId, navigate]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(session!.access_token, runId!),
    enabled: Boolean(runId && session),
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      if (!run) return 1500;
      const isTerminal = run.status === "done" || run.status === "failed";
      if (!isTerminal) return 1500;
      // The worker generates this run's fixes via a real model call *after*
      // marking it done (runWorker.ts) — that can take tens of seconds, not
      // the near-instant lookup the old templated-only version did. Keep
      // polling a while past the terminal status so a fix list that lands
      // late isn't missed, instead of stopping the instant status flips.
      if (!run.finished_at) return false;
      const msSinceFinished = Date.now() - new Date(run.finished_at).getTime();
      return msSinceFinished < 45_000 ? 1500 : false;
    },
  });

  const run = data?.run;
  const attempts = data?.attempts ?? [];
  const fixes = data?.fixes ?? [];
  const displaySiteUrl = data?.site?.url ?? contextSiteUrl;

  useEffect(() => {
    if (!run || run.score == null) return;
    const target = run.score;
    const start = performance.now();
    const durationMs = 900;
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setDisplayScore(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run?.score]);

  const scoreColor = useMemo(() => {
    if (run?.score == null) return "rgba(233,233,237,.3)";
    if (run.score >= 80) return "#30A46C";
    if (run.score >= 60) return "#F5A524";
    return "#E5484D";
  }, [run?.score]);

  const band = useMemo(() => {
    if (run?.score == null) return null;
    if (run.score >= 80) return { label: "PASS BAND · 80–100", color: "#30A46C" };
    if (run.score >= 60) return { label: "WATCH BAND · 60–79", color: "#F5A524" };
    return { label: "FAIL BAND · 0–59", color: "#E5484D" };
  }, [run?.score]);

  const lastAttempt = useMemo(() => latestAttempt(attempts), [attempts]);
  const successCount = attempts.filter((a) => a.outcome === "success").length;

  const { data: videoData } = useQuery({
    queryKey: ["run-video", runId, lastAttempt?.video_path],
    queryFn: () => fetchRunVideoUrl(session!.access_token, runId!),
    enabled: Boolean(runId && session && lastAttempt?.video_path),
    retry: false,
  });

  const hasStuckReasons = attempts.some((a) => a.stuck_reason);
  const isRecentlyFinished = Boolean(run?.finished_at) && Date.now() - new Date(run!.finished_at!).getTime() < 45_000;
  const emptyFixesMessage = !hasStuckReasons
    ? "No issues found — every attempt reached checkout."
    : isRecentlyFinished
      ? "Generating fixes…"
      : "No fixes could be generated for this run's failure reasons.";

  if (!runId) return null;

  if (isError) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#E5484D" }}>
        Failed to load this run.
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--text-dimmer)" }}>
        Loading result…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: "min(1440px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns: "216px 1fr",
          overflow: "hidden",
        }}
      >
        <Sidebar active="Dashboard" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px", gap: 12 }}>
            <span className="mono" style={{ fontSize: 13, color: "var(--text-dimmer)" }}>
              DASHBOARD / {displaySiteUrl.replace(/^https?:\/\//, "").toUpperCase()} /
            </span>
            <span className="mono" style={{ fontSize: 13 }}>
              RUN {new Date(run.created_at).toISOString().slice(0, 16).replace("T", " ")}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {shareError && <span style={{ fontSize: 12, color: "#E5484D" }}>{shareError}</span>}
              <button
                onClick={handleShare}
                disabled={sharing || run.status !== "done"}
                style={{ font: "500 13px/1 Inter, sans-serif", color: "rgba(233,233,237,.8)", border: "1px solid rgba(233,233,237,.16)", borderRadius: 6, padding: "9px 14px", background: "transparent", opacity: sharing ? 0.6 : 1 }}
              >
                {sharing ? "Sharing…" : "Share"}
              </button>
              <button
                onClick={() => navigate("/new-test")}
                style={{ font: "500 13px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "9px 14px", background: "transparent" }}
              >
                Re-run test
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 48, padding: "40px 32px 36px", borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 36 }}>
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <span className="mono" style={{ fontWeight: 700, fontSize: 132, lineHeight: 0.85, color: scoreColor, letterSpacing: "-0.05em" }}>
                  {run.score == null ? "—" : displayScore}
                </span>
                <span className="mono" style={{ fontSize: 22, color: "var(--text-faint)", marginTop: 10 }}>/100</span>
              </div>
              <div style={{ paddingTop: 8 }}>
                {band && (
                  <div
                    className="mono"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      border: `1px solid ${band.color}80`,
                      background: `${band.color}1A`,
                      borderRadius: 5,
                      padding: "6px 10px",
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.1em",
                      color: band.color,
                    }}
                  >
                    {band.label}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 22 }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 26, color: "#F5A524" }}>
                    {successCount} / {attempts.length}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-dimmer)" }}>attempts reached checkout</span>
                </div>
              </div>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 18 }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>RUN DETAIL</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 13 }}>
                <span style={{ color: "rgba(233,233,237,.55)" }}>Goal</span>
                <span className="mono" style={{ fontSize: 12, maxWidth: 200, textAlign: "right" }}>{run.goal}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "rgba(233,233,237,.55)" }}>Duration</span>
                <span className="mono" style={{ fontSize: 12 }}>{formatDuration(run.started_at, run.finished_at)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "rgba(233,233,237,.55)" }}>Cost</span>
                <span className="mono" style={{ fontSize: 12 }}>{run.cost_usd == null ? "—" : `$${run.cost_usd.toFixed(2)}`}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "rgba(233,233,237,.55)" }}>Status</span>
                <span className="mono" style={{ fontSize: 12 }}>{run.status.toUpperCase()}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 48, padding: 32 }}>
            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>
                CHECKPOINTS {lastAttempt ? `· ATTEMPT ${lastAttempt.attempt_number}` : ""}
              </div>
              <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {CHECKPOINT_RAIL.map((cp, i) => {
                  const found = lastAttempt?.checkpoints.find((c) => c.name === cp.name);
                  const status: CpStatus = found == null || found.passed == null ? "pending" : found.passed ? "pass" : "fail";
                  return (
                    <div
                      key={cp.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 16px",
                        borderBottom: i < CHECKPOINT_RAIL.length - 1 ? "1px solid rgba(233,233,237,.08)" : "none",
                        background: status === "fail" ? "rgba(229,72,77,.06)" : "transparent",
                      }}
                    >
                      <StatusIcon status={status} />
                      <span style={{ font: "500 14px/1 Inter, sans-serif", width: 150, color: status === "fail" ? "#E5484D" : "var(--text)" }}>
                        {cp.rowLabel}
                      </span>
                      <span style={{ fontSize: 13, color: "rgba(233,233,237,.55)", flex: 1 }}>
                        {found?.reason ?? (status === "pass" ? "Passed." : status === "fail" ? "Not reached." : "Not attempted.")}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginTop: 36 }}>
                FIX LIST {fixes.length > 0 ? `· ${fixes.length} ITEMS` : ""}
              </div>
              {fixes.length === 0 ? (
                <p style={{ marginTop: 16, fontSize: 13, color: "var(--text-dimmer)" }}>{emptyFixesMessage}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                  {fixes.map((fix, i) => (
                    <div key={fix.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 18, display: "grid", gridTemplateColumns: "32px 1fr", gap: 16 }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: 20, color: fix.severity === "critical" ? "#E5484D" : "#F5A524" }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div style={{ font: "500 15px/1.3 Inter, sans-serif" }}>{fix.problem}</div>
                        {fix.likely_cause && <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.55, color: "rgba(233,233,237,.6)" }}>{fix.likely_cause}</p>}
                        <pre className="mono" style={{ margin: "12px 0 0", border: "1px solid var(--border-soft)", borderRadius: 5, background: "var(--panel-deep)", padding: "12px 14px", fontSize: 12, lineHeight: 1.6, color: "rgba(233,233,237,.72)", whiteSpace: "pre-wrap" }}>
                          {fix.suggested_fix}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>RUN VIDEO</div>
              <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {videoData?.url ? (
                  <video controls src={videoData.url} style={{ width: "100%", display: "block", background: "#000" }} />
                ) : (
                  <div style={{ height: 160, display: "grid", placeItems: "center", background: "var(--panel-deep)", fontSize: 13, color: "var(--text-dimmer)" }}>
                    No recording available for this run.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 28, border: "1px solid var(--border)", borderRadius: 6, padding: 18 }}>
                <div className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>ATTEMPTS</div>
                <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14, fontSize: 12 }}>
                  {attempts.map((a) => {
                    const passedCount = a.checkpoints.filter((c) => c.passed).length;
                    const pct = Math.round((passedCount / CHECKPOINT_RAIL.length) * 100);
                    const lastFailedCp = CHECKPOINT_RAIL.find((cp) => a.checkpoints.find((c) => c.name === cp.name)?.passed === false);
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "var(--text-faint)", width: 16 }}>{a.attempt_number}</span>
                        <div
                          style={{
                            flex: 1,
                            height: 5,
                            borderRadius: 3,
                            background:
                              a.outcome === "success"
                                ? "#30A46C"
                                : `linear-gradient(to right,#E5484D ${pct}%,rgba(233,233,237,.12) ${pct}%)`,
                          }}
                        />
                        <span style={{ color: a.outcome === "success" ? "#30A46C" : "#E5484D" }}>
                          {a.outcome === "success" ? "CHECKOUT" : lastFailedCp?.railLabel ?? "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
