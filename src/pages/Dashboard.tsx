import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { fetchSites, type DashboardSite } from "../lib/api";

type Band = "all" | "pass" | "watch" | "fail";

function scoreColor(score: number | null): string {
  if (score == null) return "rgba(233,233,237,.35)";
  if (score >= 80) return "#30A46C";
  if (score >= 60) return "#F5A524";
  return "#E5484D";
}

function bandOf(score: number | null): Exclude<Band, "all"> | null {
  if (score == null) return null;
  if (score >= 80) return "pass";
  if (score >= 60) return "watch";
  return "fail";
}

const STATE_LABEL: Record<DashboardSite["state"], string> = {
  monitored: "MONITORED",
  not_monitored: "NOT MONITORED",
  never_run: "NEVER RUN",
};
const STATE_COLOR: Record<DashboardSite["state"], string> = {
  monitored: "#30A46C",
  not_monitored: "rgba(233,233,237,.5)",
  never_run: "rgba(233,233,237,.35)",
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div style={{ width: 72, height: 24, display: "grid", placeItems: "center", fontSize: 10, color: "rgba(233,233,237,.3)" }}>—</div>;
  }
  const w = 72;
  const h = 24;
  const max = 100;
  const min = 0;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke={scoreColor(last)} strokeWidth="1.5" />
    </svg>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [filter, setFilter] = useState<Band>("all");

  const { data: sites, isLoading, isError } = useQuery({
    queryKey: ["sites"],
    queryFn: () => fetchSites(session!.access_token),
    enabled: Boolean(session),
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!sites) return [];
    if (filter === "all") return sites;
    return sites.filter((s) => bandOf(s.latestRun?.score ?? null) === filter);
  }, [sites, filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: "min(1440px, 100%)",
          minHeight: 640,
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
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px", gap: 16 }}>
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Dashboard</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", fontSize: 12, marginLeft: "auto" }}>
              {(["all", "pass", "watch", "fail"] as Band[]).map((b, i) => (
                <button
                  key={b}
                  onClick={() => setFilter(b)}
                  style={{
                    padding: "6px 13px",
                    background: "transparent",
                    border: "none",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                    color: filter === b ? "var(--accent-text)" : "var(--text-dim)",
                    boxShadow: filter === b ? "inset 0 0 0 1px var(--accent)" : "none",
                    textTransform: "capitalize",
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: 32 }}>
            {isError && <p style={{ color: "#E5484D", fontSize: 13 }}>Failed to load sites.</p>}
            {isLoading && <p style={{ color: "var(--text-dimmer)", fontSize: 13 }}>Loading…</p>}

            {!isLoading && sites && sites.length === 0 && (
              <div style={{ padding: "64px 0", textAlign: "center" }}>
                <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 16 }}>No sites yet.</p>
                <button
                  onClick={() => navigate("/new-test")}
                  style={{ font: "500 13px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "10px 18px", background: "transparent" }}
                >
                  Run your first scan
                </button>
              </div>
            )}

            {!isLoading && sites && sites.length > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {filtered.map((site, i) => {
                  const score = site.latestRun?.score ?? null;
                  const dropped = site.previousScore != null && score != null && score < site.previousScore;
                  return (
                    <div
                      key={site.id}
                      onClick={() => navigate(`/sites/${site.id}`)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 20,
                        padding: "16px 20px",
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(233,233,237,.08)" : "none",
                        cursor: "pointer",
                        background: dropped ? "rgba(229,72,77,.06)" : "transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: "500 14px/1.2 Inter, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {site.label || site.url}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                          {site.url.replace(/^https?:\/\//, "")}
                        </div>
                      </div>

                      <Sparkline values={site.sparkline} />

                      <div style={{ width: 90, textAlign: "right" }}>
                        {score != null ? (
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
                            {dropped && (
                              <span className="mono" style={{ fontSize: 11, color: "#E5484D" }}>
                                {site.previousScore} →
                              </span>
                            )}
                            <span className="mono" style={{ fontWeight: 700, fontSize: 22, color: scoreColor(score) }}>{score}</span>
                          </div>
                        ) : (
                          <span className="mono" style={{ fontSize: 13, color: "var(--text-faint)" }}>—</span>
                        )}
                      </div>

                      <div style={{ width: 80, textAlign: "right", fontSize: 12, color: "var(--text-dimmer)" }}>{timeAgo(site.lastRunAt)}</div>

                      <div
                        className="mono"
                        style={{
                          width: 110,
                          textAlign: "right",
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: "0.08em",
                          color: STATE_COLOR[site.state],
                        }}
                      >
                        {STATE_LABEL[site.state]}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
