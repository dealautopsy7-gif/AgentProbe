import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import {
  fetchSchedules,
  fetchSites,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  type ScheduleWithSite,
  type Cadence,
} from "../lib/api";

function ScheduleRow({ schedule, onChanged }: { schedule: ScheduleWithSite; onChanged: () => void }) {
  const { session } = useAuth();
  const [cadence, setCadence] = useState<Cadence>(schedule.cadence);
  const [threshold, setThreshold] = useState(schedule.alert_threshold);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await updateSchedule(session.access_token, schedule.id, { cadence, alertThreshold: threshold });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!session) return;
    setBusy(true);
    try {
      await deleteSchedule(session.access_token, schedule.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: "1px solid rgba(233,233,237,.08)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "500 14px/1.2 Inter, sans-serif" }}>{schedule.site?.label || schedule.site?.url || "Unknown site"}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
          {schedule.site?.url?.replace(/^https?:\/\//, "")}
        </div>
      </div>

      <div className="mono" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", fontSize: 12 }}>
        {(["daily", "weekly"] as Cadence[]).map((c, i) => (
          <button
            key={c}
            onClick={() => setCadence(c)}
            style={{
              padding: "7px 14px",
              background: "transparent",
              border: "none",
              borderLeft: i === 1 ? "1px solid var(--border)" : "none",
              color: cadence === c ? "var(--accent-text)" : "var(--text-dim)",
              boxShadow: cadence === c ? "inset 0 0 0 1px var(--accent)" : "none",
              textTransform: "uppercase",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)" }}>
        Alert below
        <input
          type="number"
          min={1}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="mono"
          style={{ width: 56, height: 32, border: "1px solid var(--border)", borderRadius: 5, background: "var(--field)", padding: "0 8px", color: "var(--text)", fontSize: 13 }}
        />
      </div>

      <button
        onClick={save}
        disabled={busy}
        style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "8px 12px", background: "transparent", opacity: busy ? 0.6 : 1 }}
      >
        Save
      </button>
      <button
        onClick={remove}
        disabled={busy}
        style={{ font: "500 12px/1 Inter, sans-serif", color: "#E5484D", border: "1px solid rgba(229,72,77,.4)", borderRadius: 6, padding: "8px 12px", background: "transparent", opacity: busy ? 0.6 : 1 }}
      >
        Turn off
      </button>
      {error && <span style={{ fontSize: 11, color: "#E5484D" }}>{error}</span>}
    </div>
  );
}

export function Monitoring() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [addingSiteId, setAddingSiteId] = useState<string | null>(null);

  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => fetchSchedules(session!.access_token),
    enabled: Boolean(session),
  });
  const { data: sites, isLoading: sitesLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: () => fetchSites(session!.access_token),
    enabled: Boolean(session),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    queryClient.invalidateQueries({ queryKey: ["sites"] });
  };

  const unmonitoredSites = useMemo(() => {
    if (!sites || !schedules) return [];
    const scheduledSiteIds = new Set(schedules.map((s) => s.site_id));
    return sites.filter((s) => !scheduledSiteIds.has(s.id));
  }, [sites, schedules]);

  async function enableMonitoring(siteId: string) {
    if (!session) return;
    setAddingSiteId(siteId);
    try {
      await createSchedule(session.access_token, { siteId, cadence: "weekly", goals: [], alertThreshold: 10, alertChannels: ["email"] });
      refresh();
    } finally {
      setAddingSiteId(null);
    }
  }

  const loading = schedulesLoading || sitesLoading;

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
        <Sidebar active="Monitoring" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px" }}>
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Monitoring</span>
          </div>

          <div style={{ padding: 32 }}>
            <div style={{ border: "1px solid rgba(245,165,36,.35)", background: "rgba(245,165,36,.08)", borderRadius: 6, padding: "14px 18px", fontSize: 13, color: "rgba(233,233,237,.75)", marginBottom: 28 }}>
              Schedules save here for real, but nothing runs them yet — the recurring scan job (a BullMQ repeatable job
              that would enqueue runs on cadence and email you on a score drop) hasn't been built. Turning monitoring on
              won't produce any new runs on its own right now.
            </div>

            {loading && <p style={{ color: "var(--text-dimmer)", fontSize: 13 }}>Loading…</p>}

            {!loading && (
              <>
                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>MONITORED SITES</div>
                <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  {!schedules || schedules.length === 0 ? (
                    <p style={{ padding: 20, fontSize: 13, color: "var(--text-dimmer)" }}>No sites are monitored yet.</p>
                  ) : (
                    schedules.map((s) => <ScheduleRow key={s.id} schedule={s} onChanged={refresh} />)
                  )}
                </div>

                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginTop: 36 }}>NOT MONITORED</div>
                <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  {unmonitoredSites.length === 0 ? (
                    <p style={{ padding: 20, fontSize: 13, color: "var(--text-dimmer)" }}>
                      {sites && sites.length === 0 ? (
                        <>No sites yet — <span style={{ color: "var(--accent-text)", cursor: "pointer" }} onClick={() => navigate("/new-test")}>run your first scan</span>.</>
                      ) : (
                        "Every site is monitored."
                      )}
                    </p>
                  ) : (
                    unmonitoredSites.map((site, i) => (
                      <div
                        key={site.id}
                        style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: i < unmonitoredSites.length - 1 ? "1px solid rgba(233,233,237,.08)" : "none" }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ font: "500 14px/1.2 Inter, sans-serif" }}>{site.label || site.url}</div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{site.url.replace(/^https?:\/\//, "")}</div>
                        </div>
                        <button
                          onClick={() => enableMonitoring(site.id)}
                          disabled={addingSiteId === site.id}
                          style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "8px 14px", background: "transparent", opacity: addingSiteId === site.id ? 0.6 : 1 }}
                        >
                          {addingSiteId === site.id ? "Enabling…" : "Enable monitoring"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
