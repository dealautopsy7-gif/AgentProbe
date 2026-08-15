import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useTestConfig } from "../context/TestConfigContext";
import { fetchRun, cancelRun, type AttemptRow, type RunRow, type RunStepRow, type CheckpointName } from "../lib/api";
import { CHECKPOINT_RAIL, deriveRailStatuses, type RailStatus } from "../lib/checkpoints";

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function mergeAttempt(prev: AttemptRow | undefined, incoming: Partial<AttemptRow> & { id: string }): AttemptRow {
  return {
    id: incoming.id,
    run_id: incoming.run_id ?? prev?.run_id ?? "",
    attempt_number: incoming.attempt_number ?? prev?.attempt_number ?? 0,
    outcome: incoming.outcome !== undefined ? incoming.outcome : (prev?.outcome ?? null),
    stuck_reason: incoming.stuck_reason !== undefined ? incoming.stuck_reason : (prev?.stuck_reason ?? null),
    video_path: incoming.video_path !== undefined ? incoming.video_path : (prev?.video_path ?? null),
    created_at: incoming.created_at ?? prev?.created_at ?? new Date().toISOString(),
    checkpoints: prev?.checkpoints ?? [],
    run_steps: prev?.run_steps ?? [],
  };
}

export function LiveRun() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { runId, siteUrl } = useTestConfig();

  const [runRow, setRunRow] = useState<RunRow | null>(null);
  const [attemptsById, setAttemptsById] = useState<Map<string, AttemptRow>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);

  async function handleStop() {
    if (!session || !runId) return;
    setStopping(true);
    try {
      await cancelRun(session.access_token, runId);
    } catch {
      // Realtime will still reflect the true status even if this request
      // itself failed to round-trip — no need to block navigation on it.
    } finally {
      navigate("/new-test");
    }
  }

  const navigatedRef = useRef(false);

  // No run to watch — bounce back rather than render an empty shell.
  useEffect(() => {
    if (!runId) navigate("/new-test", { replace: true });
  }, [runId, navigate]);

  // Merges a freshly-fetched attempt into existing state by union (not
  // overwrite) of its steps/checkpoints, so a hydrate race never regresses
  // data that already arrived live.
  function unionAttempt(prev: AttemptRow | undefined, fetched: AttemptRow): AttemptRow {
    if (!prev) return fetched;
    const stepIds = new Set(prev.run_steps.map((s) => s.id));
    const run_steps = [...prev.run_steps, ...fetched.run_steps.filter((s) => !stepIds.has(s.id))].sort(
      (a, b) => a.step_number - b.step_number,
    );
    const cpNames = new Set(prev.checkpoints.map((c) => c.name));
    const checkpoints = [...prev.checkpoints, ...fetched.checkpoints.filter((c) => !cpNames.has(c.name))];
    return { ...fetched, outcome: fetched.outcome ?? prev.outcome, run_steps, checkpoints };
  }

  // Fetches current run state and merges it into local state. Called once
  // on mount for a fast first paint, and again the moment the Realtime
  // channel reports SUBSCRIBED — that second call is what actually matters:
  // anything the worker wrote in the gap between mount and the socket going
  // live would otherwise be silently missed (Realtime doesn't replay past
  // events), and a stub attempt can easily produce its first step or two
  // inside that gap.
  function hydrate() {
    if (!runId || !session) return;
    fetchRun(session.access_token, runId)
      .then((full) => {
        setRunRow((prev) => ({ ...prev, ...full.run }));
        setAttemptsById((prev) => {
          const next = new Map(prev);
          for (const a of full.attempts) next.set(a.id, unionAttempt(next.get(a.id), a));
          return next;
        });
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load run"));
  }

  useEffect(hydrate, [runId, session]);

  // Realtime subscription — this is what actually streams the run, per spec:
  // "do not poll on a tight loop — stream." RLS scopes delivery to rows this
  // user can already SELECT, so no extra auth wiring needed beyond the
  // client already carrying the session.
  useEffect(() => {
    if (!runId) return;

    const channel = supabase
      .channel(`run-${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `id=eq.${runId}` },
        (payload) => setRunRow((prev) => ({ ...(prev as RunRow), ...(payload.new as RunRow) })),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attempts", filter: `run_id=eq.${runId}` },
        (payload) => {
          const row = payload.new as Partial<AttemptRow> & { id: string };
          setAttemptsById((prev) => {
            const next = new Map(prev);
            next.set(row.id, mergeAttempt(prev.get(row.id), row));
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "run_steps" },
        (payload) => {
          const step = payload.new as RunStepRow;
          setAttemptsById((prev) => {
            const attempt = prev.get(step.attempt_id);
            if (!attempt) return prev; // step for an attempt we haven't seen the INSERT for yet
            if (attempt.run_steps.some((s) => s.id === step.id)) return prev;
            const next = new Map(prev);
            next.set(attempt.id, { ...attempt, run_steps: [...attempt.run_steps, step].sort((a, b) => a.step_number - b.step_number) });
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checkpoints" },
        (payload) => {
          const cp = payload.new as { id: string; attempt_id: string; name: CheckpointName; passed: boolean | null; reason: string | null };
          setAttemptsById((prev) => {
            const attempt = prev.get(cp.attempt_id);
            if (!attempt) return prev;
            const existingIdx = attempt.checkpoints.findIndex((c) => c.name === cp.name);
            const checkpoints = [...attempt.checkpoints];
            if (existingIdx >= 0) checkpoints[existingIdx] = cp;
            else checkpoints.push(cp);
            const next = new Map(prev);
            next.set(attempt.id, { ...attempt, checkpoints });
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") hydrate();
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, session]);

  const attempts = useMemo(
    () => [...attemptsById.values()].sort((a, b) => a.attempt_number - b.attempt_number),
    [attemptsById],
  );
  const currentAttempt = attempts[attempts.length - 1];
  const attemptsTotal = runRow?.attempts_total ?? attempts.length ?? 1;
  const attemptConcluded = currentAttempt?.outcome != null;

  // Elapsed clock, grounded in the current attempt's real created_at.
  useEffect(() => {
    if (!currentAttempt) return;
    const start = new Date(currentAttempt.created_at).getTime();
    setElapsed((Date.now() - start) / 1000);
    const id = window.setInterval(() => setElapsed((Date.now() - start) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [currentAttempt?.id]);

  // Once the run concludes, move on — Result for a real outcome, straight
  // back to New Test for a cancellation (there's no meaningful score to show).
  useEffect(() => {
    if (!runRow || navigatedRef.current) return;
    if (runRow.status === "done" || runRow.status === "failed") {
      navigatedRef.current = true;
      const id = window.setTimeout(() => navigate("/result"), 900);
      return () => window.clearTimeout(id);
    }
    if (runRow.status === "cancelled") {
      navigatedRef.current = true;
      navigate("/new-test");
    }
  }, [runRow, navigate]);

  const passedByName = useMemo(() => {
    const map: Partial<Record<CheckpointName, boolean>> = {};
    for (const cp of currentAttempt?.checkpoints ?? []) {
      if (cp.passed != null) map[cp.name] = cp.passed;
    }
    return map;
  }, [currentAttempt]);
  const railStatuses = useMemo(() => deriveRailStatuses(passedByName, attemptConcluded), [passedByName, attemptConcluded]);

  const railColor = (status: RailStatus) => {
    switch (status) {
      case "pass":
        return { border: "rgba(48,164,108,.5)", bg: "rgba(48,164,108,.10)", text: "#30A46C" };
      case "fail":
        return { border: "#E5484D", bg: "rgba(229,72,77,.12)", text: "#E5484D" };
      default:
        return { border: "rgba(233,233,237,.14)", bg: "transparent", text: "rgba(233,233,237,.35)" };
    }
  };

  const cookieBlocked = attemptConcluded && (currentAttempt?.stuck_reason?.toLowerCase().includes("cookie") ?? false);

  if (!runId) return null;

  if (loadError) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#E5484D", padding: 24, textAlign: "center" }}>
        {loadError}
      </div>
    );
  }

  if (!runRow || !currentAttempt) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--text-dimmer)" }}>
        Connecting to run…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: "min(1440px, 100%)",
          height: 880,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ height: 52, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 20, padding: "0 24px", background: "var(--panel-alt)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", animation: "ap-pulse 1.4s infinite" }} />
            <span className="mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", color: "var(--cyan)" }}>
              AGENT RUNNING
            </span>
          </div>
          <span className="mono" style={{ fontSize: 13, color: "rgba(233,233,237,.75)" }}>
            {siteUrl.replace(/^https?:\/\//, "")}
          </span>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
            ATTEMPT {currentAttempt.attempt_number}/{attemptsTotal}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-faint)" }}>ELAPSED</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 5 }}>{formatClock(elapsed)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-faint)" }}>STEPS</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 5 }}>{currentAttempt.run_steps.length}</div>
            </div>
            <button
              onClick={handleStop}
              disabled={stopping}
              style={{ font: "500 13px/1 Inter, sans-serif", color: "rgba(233,233,237,.7)", border: "1px solid rgba(233,233,237,.16)", borderRadius: 6, padding: "8px 14px", background: "transparent", opacity: stopping ? 0.6 : 1 }}
            >
              {stopping ? "Stopping…" : "Stop run"}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "60fr 40fr", minHeight: 0 }}>
          <div style={{ borderRight: "1px solid var(--border-soft)", padding: 20, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ height: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid var(--border-soft)", background: "var(--panel-alt)" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
                </div>
                <div className="mono" style={{ flex: 1, height: 20, borderRadius: 4, background: "#1b1d29", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10, color: "var(--text-dimmer)" }}>
                  {siteUrl.replace(/^https?:\/\//, "")}/products/…
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>1440 × 900</span>
              </div>
              <div style={{ flex: 1, position: "relative", background: "#1c1e2a", padding: 22, minHeight: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 16, borderBottom: "1px solid rgba(233,233,237,.08)" }}>
                  <div style={{ width: 90, height: 12, borderRadius: 3, background: "#2f3240" }} />
                  <div style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
                    <div style={{ width: 46, height: 9, borderRadius: 3, background: "#282b38" }} />
                    <div style={{ width: 46, height: 9, borderRadius: 3, background: "#282b38" }} />
                    <div style={{ width: 46, height: 9, borderRadius: 3, background: "#282b38" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 28, marginTop: 24 }}>
                  <div style={{ width: 300, height: 230, borderRadius: 5, background: "repeating-linear-gradient(135deg,#252836,#252836 8px,#20232f 8px,#20232f 16px)", display: "grid", placeItems: "center", fontSize: 10, color: "rgba(233,233,237,.28)" }} className="mono">
                    PRODUCT IMAGE
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ border: "1px solid var(--cyan)", borderRadius: 4, padding: "8px 12px", alignSelf: "flex-start" }}>
                      <div style={{ font: "500 19px/1 Inter, sans-serif", color: "rgba(233,233,237,.8)" }}>Trail 28 Backpack</div>
                    </div>
                    <div style={{ width: "60%", height: 9, borderRadius: 3, background: "#252836" }} />
                    <div style={{ width: "44%", height: 9, borderRadius: 3, background: "#252836" }} />
                  </div>
                </div>
                <div style={{ position: "absolute", left: 350, bottom: cookieBlocked ? 104 : 60, width: 260 }}>
                  <div
                    style={{
                      height: 42,
                      border: `1px solid ${railStatuses.added_to_cart === "pass" ? "var(--green)" : "var(--cyan)"}`,
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "500 13px/1 Inter, sans-serif",
                      color: "rgba(233,233,237,.45)",
                    }}
                  >
                    Add to cart
                  </div>
                </div>
                {cookieBlocked && (
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 22px", background: "#232633", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)", flex: 1 }}>We use cookies to improve your experience. Manage preferences at any time.</span>
                    <span style={{ font: "500 11px/1 Inter, sans-serif", padding: "8px 12px", border: "1px solid rgba(233,233,237,.35)", borderRadius: 4 }}>Accept all</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text-dimmer)" }}>CHECKPOINTS</span>
              <div style={{ display: "flex", gap: 6, flex: 1 }}>
                {CHECKPOINT_RAIL.map(({ name, railLabel }) => {
                  const c = railColor(railStatuses[name]);
                  return (
                    <div
                      key={name}
                      className="mono"
                      style={{ flex: 1, height: 26, borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 500, color: c.text }}
                    >
                      {railLabel}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel-deep)" }}>
            <div style={{ height: 40, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--border-soft)" }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>THOUGHT LOG</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-faint)" }}>
                {import.meta.env.DEV ? "STUB AGENT" : "GPT-BROWSE · TEMP 0.2"}
              </span>
            </div>
            <div className="mono" style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 9, fontSize: 12, lineHeight: 1.5, overflow: "auto" }}>
              {currentAttempt.run_steps.map((step, i) => {
                const isLast = i === currentAttempt.run_steps.length - 1;
                const failed = isLast && attemptConcluded && currentAttempt.outcome !== "success";
                const succeeded = isLast && attemptConcluded && currentAttempt.outcome === "success";
                const secondsIn = (new Date(step.timestamp).getTime() - new Date(currentAttempt.created_at).getTime()) / 1000;
                if (failed) {
                  return (
                    <div key={step.id} style={{ display: "flex", gap: 10, color: "#E5484D", padding: "8px 10px", margin: "2px -10px 0", border: "1px solid rgba(229,72,77,.45)", borderRadius: 4, background: "rgba(229,72,77,.10)" }}>
                      <span style={{ color: "rgba(229,72,77,.6)", flex: "none" }}>{formatClock(secondsIn)}</span>
                      <span>{step.agent_reasoning}</span>
                    </div>
                  );
                }
                return (
                  <div key={step.id} style={{ display: "flex", gap: 10, color: succeeded ? "var(--green)" : "rgba(233,233,237,.62)" }}>
                    <span style={{ color: "rgba(233,233,237,.28)", flex: "none" }}>{formatClock(secondsIn)}</span>
                    <span>{step.agent_reasoning}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ borderTop: "1px solid var(--border-soft)", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              {attemptConcluded && currentAttempt.outcome !== "success" ? (
                <>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: "#E5484D", border: "1px solid rgba(229,72,77,.45)", borderRadius: 4, padding: "6px 9px" }}>
                    RUN HALTED
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-dim)", flex: 1 }}>
                    {currentAttempt.attempt_number < attemptsTotal ? "Starting the next attempt…" : "Compiling result…"}
                  </span>
                </>
              ) : attemptConcluded && currentAttempt.outcome === "success" ? (
                <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: "var(--green)", border: "1px solid rgba(48,164,108,.45)", borderRadius: 4, padding: "6px 9px" }}>
                  ATTEMPT COMPLETE
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>Agent is working…</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
