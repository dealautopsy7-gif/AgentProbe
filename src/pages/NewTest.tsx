import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { CHECKPOINTS, useTestConfig } from "../context/TestConfigContext";
import { useAuth } from "../context/AuthContext";
import { createRun, ApiError } from "../lib/api";

const CheckIcon = () => (
  <svg width="9" height="9" viewBox="0 0 12 12">
    <path d="M2 6.4l2.6 2.6L10 3.4" stroke="#161826" strokeWidth="2" fill="none" />
  </svg>
);

function estimate(attempts: number, checkedCount: number) {
  const totalSeconds = attempts * Math.max(checkedCount, 1) * 19;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const cost = attempts * 0.084;
  return {
    durationLabel: `${mins}m ${String(secs).padStart(2, "0")}s`,
    cost: `$${cost.toFixed(2)}`,
  };
}

export function NewTest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    siteUrl,
    setSiteUrl,
    mode,
    setMode,
    freeTextGoal,
    setFreeTextGoal,
    checkedCheckpoints,
    toggleCheckpoint,
    attempts,
    setAttempts,
    alsoMonitor,
    setAlsoMonitor,
    setRunId,
  } = useTestConfig();
  const { session } = useAuth();

  // Carries the URL typed on the (not-yet-built) landing page through auth.
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) setSiteUrl(urlParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const checkedCount = checkedCheckpoints.size;
  const { durationLabel, cost } = estimate(attempts, checkedCount);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  async function handleRunTest() {
    if (!session) return; // RequireAuth guarantees this in practice
    setSubmitError(null);
    setUpgradeRequired(false);
    setSubmitting(true);

    const goal =
      mode === "freetext"
        ? freeTextGoal
        : CHECKPOINTS.filter((cp) => checkedCheckpoints.has(cp.id))
            .map((cp) => cp.label)
            .join(", ") || "Complete a purchase";

    try {
      const { runId } = await createRun(session.access_token, { url: siteUrl, goal, attempts });
      setRunId(runId);
      navigate("/live-run");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to start the test");
      setUpgradeRequired(err instanceof ApiError && err.status === 402);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: "min(1440px, 100%)",
          height: 840,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns: "216px 1fr",
          overflow: "hidden",
        }}
      >
        <Sidebar active="New test" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              height: 56,
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              padding: "0 32px",
              gap: 12,
            }}
          >
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>New test</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>
              7 RUNS LEFT THIS MONTH
            </span>
          </div>

          <div style={{ padding: "36px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 36, alignItems: "start", overflowY: "auto" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-dim)", marginBottom: 7 }}>
                Site URL
              </label>
              <input
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="mono"
                style={{
                  width: "100%",
                  height: 46,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--field)",
                  padding: "0 14px",
                  fontSize: 14,
                  color: "var(--text)",
                }}
              />

              <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ font: "500 15px/1 Inter, sans-serif" }}>What should the agent try to do?</span>
                  <div
                    style={{
                      display: "inline-flex",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      overflow: "hidden",
                      fontSize: 12,
                      marginLeft: "auto",
                    }}
                  >
                    <button
                      onClick={() => setMode("checkpoints")}
                      style={{
                        padding: "6px 13px",
                        color: mode === "checkpoints" ? "var(--accent-text)" : "var(--text-dim)",
                        boxShadow: mode === "checkpoints" ? "inset 0 0 0 1px var(--accent)" : "none",
                        background: "transparent",
                        border: "none",
                      }}
                    >
                      Checkpoints
                    </button>
                    <button
                      onClick={() => setMode("freetext")}
                      style={{
                        padding: "6px 13px",
                        color: mode === "freetext" ? "var(--accent-text)" : "var(--text-dim)",
                        boxShadow: mode === "freetext" ? "inset 0 0 0 1px var(--accent)" : "none",
                        borderLeft: "1px solid var(--border)",
                        background: "transparent",
                      }}
                    >
                      Free-text goal
                    </button>
                  </div>
                </div>

                {mode === "checkpoints" ? (
                  <>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        marginTop: 18,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        overflow: "hidden",
                      }}
                    >
                      {CHECKPOINTS.map((cp, i) => {
                        const checked = checkedCheckpoints.has(cp.id);
                        return (
                          <div
                            key={cp.id}
                            onClick={() => toggleCheckpoint(cp.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "13px 16px",
                              borderBottom: i < CHECKPOINTS.length - 1 ? "1px solid rgba(233,233,237,.08)" : "none",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                width: 15,
                                height: 15,
                                borderRadius: 3,
                                border: `1px solid ${checked ? "var(--accent)" : "rgba(233,233,237,.25)"}`,
                                background: checked ? "var(--accent)" : "transparent",
                                display: "grid",
                                placeItems: "center",
                                flex: "none",
                              }}
                            >
                              {checked && <CheckIcon />}
                            </div>
                            <span style={{ fontSize: 14, flex: 1, color: checked ? "var(--text)" : "var(--text-dim)" }}>
                              {cp.label}
                            </span>
                            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                              {cp.code}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-dimmer)" }}>
                      Checkout is simulated — the agent stops at the payment step and never submits.
                    </p>
                  </>
                ) : (
                  <textarea
                    value={freeTextGoal}
                    onChange={(e) => setFreeTextGoal(e.target.value)}
                    rows={4}
                    placeholder="Describe what the agent should try to accomplish…"
                    style={{
                      width: "100%",
                      marginTop: 18,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--field)",
                      padding: "12px 14px",
                      fontSize: 14,
                      color: "var(--text)",
                      resize: "vertical",
                      fontFamily: "Inter, sans-serif",
                    }}
                  />
                )}
              </div>

              <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--border-soft)" }}>
                <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Attempts</span>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
                  <div
                    className="mono"
                    style={{
                      display: "inline-flex",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      overflow: "hidden",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {[1, 5].map((n, i) => (
                      <button
                        key={n}
                        onClick={() => setAttempts(n as 1 | 5)}
                        style={{
                          padding: "9px 18px",
                          background: "transparent",
                          border: "none",
                          borderLeft: i === 1 ? "1px solid var(--border)" : "none",
                          color: attempts === n ? "var(--accent-text)" : "var(--text-dim)",
                          boxShadow: attempts === n ? "inset 0 0 0 1px var(--accent)" : "none",
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text-dimmer)" }}>
                    Five attempts give a completion rate, not just a yes or no.
                  </span>
                </div>
              </div>
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 20 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text-dimmer)" }}>
                RUN SUMMARY
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontSize: 13 }}>
                <span style={{ color: "var(--text-dim)" }}>Checkpoints</span>
                <span className="mono">
                  {mode === "checkpoints" ? `${checkedCount} of ${CHECKPOINTS.length}` : "Inferred from goal"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "var(--text-dim)" }}>Attempts</span>
                <span className="mono">{attempts}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "var(--text-dim)" }}>Est. duration</span>
                <span className="mono">{durationLabel}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 10,
                  paddingTop: 14,
                  borderTop: "1px solid var(--border-soft)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--text-dim)" }}>Est. cost</span>
                <span className="mono">{cost}</span>
              </div>
              <button
                onClick={handleRunTest}
                disabled={submitting || !siteUrl.trim()}
                style={{
                  width: "100%",
                  height: 44,
                  marginTop: 20,
                  border: "1px solid var(--accent)",
                  borderRadius: 6,
                  display: "grid",
                  placeItems: "center",
                  font: "500 14px/1 Inter, sans-serif",
                  color: "var(--accent-text)",
                  background: "transparent",
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? "Starting…" : "Run AI test"}
              </button>
              {submitError && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#E5484D" }}>
                  {submitError}
                  {upgradeRequired && (
                    <>
                      {" "}
                      <span style={{ color: "var(--accent-text)", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/billing")}>
                        Upgrade
                      </span>
                    </>
                  )}
                </p>
              )}
              <div
                onClick={() => setAlsoMonitor(!alsoMonitor)}
                style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "var(--text-dimmer)", cursor: "pointer" }}
              >
                <div
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 3,
                    border: `1px solid ${alsoMonitor ? "var(--accent)" : "rgba(233,233,237,.25)"}`,
                    background: alsoMonitor ? "var(--accent)" : "transparent",
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  {alsoMonitor && <CheckIcon />}
                </div>
                Also add to weekly monitoring
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
