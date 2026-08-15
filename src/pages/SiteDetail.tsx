import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { fetchSiteDetail, updateSiteAlerts, type SiteRunSummary } from "../lib/api";

function scoreColor(score: number | null): string {
  if (score == null) return "rgba(233,233,237,.35)";
  if (score >= 80) return "#30A46C";
  if (score >= 60) return "#F5A524";
  return "#E5484D";
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["site", id],
    queryFn: () => fetchSiteDetail(session!.access_token, id!),
    enabled: Boolean(session && id),
  });

  const [threshold, setThreshold] = useState(10);
  const [emailOn, setEmailOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (data?.schedule) {
      setThreshold(data.schedule.alert_threshold);
      setEmailOn(data.schedule.alert_channels.includes("email"));
    }
  }, [data?.schedule]);

  async function handleSaveAlerts() {
    if (!session || !id) return;
    setSaving(true);
    setSaveError(null);
    setSavedNotice(false);
    try {
      await updateSiteAlerts(session.access_token, id, {
        alertThreshold: threshold,
        alertChannels: emailOn ? ["email"] : [],
      });
      await queryClient.invalidateQueries({ queryKey: ["site", id] });
      setSavedNotice(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save alert settings");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--text-dimmer)" }}>Loading…</div>;
  }
  if (isError || !data) {
    return <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#E5484D" }}>Site not found.</div>;
  }

  const { site, runs, schedule, latestAlert } = data;
  const doneRuns = [...runs].filter((r) => r.status === "done" && r.score != null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const chartData = doneRuns.map((r) => ({ date: formatDate(r.created_at).slice(5, 16), score: r.score }));

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
            <span
              className="mono"
              style={{ fontSize: 13, color: "var(--text-dimmer)", cursor: "pointer" }}
              onClick={() => navigate("/dashboard")}
            >
              DASHBOARD /
            </span>
            <span className="mono" style={{ fontSize: 13 }}>{(site.label || site.url).toUpperCase()}</span>
            <button
              onClick={() => navigate(`/new-test?url=${encodeURIComponent(site.url)}`)}
              style={{ marginLeft: "auto", font: "500 13px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "9px 14px", background: "transparent" }}
            >
              Run new test
            </button>
          </div>

          <div style={{ padding: "32px 32px 0" }}>
            {latestAlert && (
              <div
                style={{
                  border: "1px solid rgba(229,72,77,.35)",
                  background: "rgba(229,72,77,.08)",
                  borderRadius: 6,
                  padding: "14px 18px",
                  fontSize: 13,
                  color: "rgba(233,233,237,.85)",
                  marginBottom: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "#E5484D", border: "1px solid rgba(229,72,77,.4)", borderRadius: 4, padding: "3px 8px", flex: "none" }}>
                  CHANGES DETECTED
                </span>
                <span>
                  Score dropped from <strong className="mono">{latestAlert.old_score}</strong> to{" "}
                  <strong className="mono">{latestAlert.new_score}</strong> on {formatDate(latestAlert.triggered_at)}.
                  {!latestAlert.delivered && " (No email was sent — alerts aren't configured.)"}
                </span>
              </div>
            )}
          </div>

          <div style={{ padding: "0 32px 32px", display: "grid", gridTemplateColumns: "1fr 340px", gap: 32 }}>
            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>SCORE TREND</div>
              <div style={{ marginTop: 16, height: 220, border: "1px solid var(--border)", borderRadius: 6, padding: "16px 8px" }}>
                {chartData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="rgba(233,233,237,.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "rgba(233,233,237,.45)", fontSize: 10 }} axisLine={{ stroke: "rgba(233,233,237,.12)" }} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: "rgba(233,233,237,.45)", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip
                        contentStyle={{ background: "#161826", border: "1px solid rgba(233,233,237,.16)", borderRadius: 6, fontSize: 12 }}
                        labelStyle={{ color: "rgba(233,233,237,.6)" }}
                      />
                      <Line type="monotone" dataKey="score" stroke="#968ae0" strokeWidth={2} dot={{ r: 3, fill: "#968ae0" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-dimmer)", fontSize: 13 }}>
                    Not enough completed runs yet for a trend.
                  </div>
                )}
              </div>

              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginTop: 36 }}>RUN HISTORY</div>
              <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {runs.length === 0 ? (
                  <p style={{ padding: 20, fontSize: 13, color: "var(--text-dimmer)" }}>No runs yet.</p>
                ) : (
                  runs.map((run: SiteRunSummary, i: number) => {
                    const prev = runs[i + 1]; // runs are newest-first
                    const changed = prev && prev.score != null && run.score != null && prev.score !== run.score;
                    return (
                      <div
                        key={run.id}
                        onClick={() => navigate(`/result?runId=${run.id}`)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          padding: "14px 18px",
                          borderBottom: i < runs.length - 1 ? "1px solid rgba(233,233,237,.08)" : "none",
                          cursor: "pointer",
                        }}
                      >
                        <span className="mono" style={{ fontSize: 12, color: "var(--text-dimmer)", width: 140 }}>{formatDate(run.created_at)}</span>
                        <span className="mono" style={{ fontWeight: 700, fontSize: 18, color: scoreColor(run.score), width: 50 }}>
                          {run.score ?? "—"}
                        </span>
                        <span style={{ fontSize: 13, color: "var(--text-dim)", flex: 1 }}>
                          {run.status !== "done"
                            ? run.status.toUpperCase()
                            : run.completion_rate != null
                              ? `${Math.round(run.completion_rate * 100)}% of attempts reached checkout`
                              : "—"}
                        </span>
                        {changed && (
                          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--accent-text)" }}>CHANGED</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>ALERT SETTINGS</div>
              <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, padding: 20 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-dim)", marginBottom: 7 }}>
                  Alert if score drops below
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="mono"
                  style={{ width: "100%", height: 40, border: "1px solid var(--border)", borderRadius: 6, background: "var(--field)", padding: "0 12px", fontSize: 14, color: "var(--text)" }}
                />

                <div
                  onClick={() => setEmailOn(!emailOn)}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, color: "var(--text-dim)", cursor: "pointer" }}
                >
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 3,
                      border: `1px solid ${emailOn ? "var(--accent)" : "rgba(233,233,237,.25)"}`,
                      background: emailOn ? "var(--accent)" : "transparent",
                    }}
                  />
                  Email alerts
                </div>

                <button
                  onClick={handleSaveAlerts}
                  disabled={saving}
                  style={{ width: "100%", height: 40, marginTop: 20, border: "1px solid var(--accent)", borderRadius: 6, color: "var(--accent-text)", background: "transparent", font: "500 13px/1 Inter, sans-serif", opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Saving…" : "Save alert settings"}
                </button>
                {saveError && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#E5484D" }}>{saveError}</p>}
                {savedNotice && !saveError && <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--green)" }}>Saved.</p>}

                <p style={{ margin: "16px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--text-faint)" }}>
                  This is saved to {schedule ? "this site's" : "a new"} monitoring schedule. The recurring scan job checks it on
                  cadence and alerts here if the score drops past this threshold (see Monitoring).
                </p>
              </div>

              {schedule && (
                <div style={{ marginTop: 20, border: "1px solid var(--border)", borderRadius: 6, padding: 20 }}>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>MONITORING</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 13 }}>
                    <span style={{ color: "var(--text-dim)" }}>Cadence</span>
                    <span className="mono" style={{ textTransform: "uppercase" }}>{schedule.cadence}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
