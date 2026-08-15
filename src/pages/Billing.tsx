import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { fetchBilling, startCheckout, ApiError, type PlanTier } from "../lib/api";

const TIER_ORDER: PlanTier[] = ["free", "pro", "agency"];
const TIER_FEATURES: Record<PlanTier, string> = {
  free: "1 site · 1 test · public result",
  pro: "10 sites · weekly scans · history · alerts",
  agency: "Unlimited sites · client workspaces · white-label reports",
};

export function Billing() {
  const { session } = useAuth();
  const [checkoutState, setCheckoutState] = useState<{ tier: PlanTier; message: string } | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<PlanTier | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["billing"],
    queryFn: () => fetchBilling(session!.access_token),
    enabled: Boolean(session),
  });

  async function handleUpgrade(tier: "pro" | "agency") {
    if (!session) return;
    setCheckoutBusy(tier);
    setCheckoutState(null);
    try {
      const { url } = await startCheckout(session.access_token, tier);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to start checkout";
      setCheckoutState({ tier, message });
    } finally {
      setCheckoutBusy(null);
    }
  }

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
        <Sidebar active="Billing" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px" }}>
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Billing</span>
          </div>

          <div style={{ padding: 32 }}>
            <div
              style={{
                border: "1px solid rgba(245,165,36,.35)",
                background: "rgba(245,165,36,.08)",
                borderRadius: 6,
                padding: "14px 18px",
                fontSize: 13,
                color: "rgba(233,233,237,.75)",
                marginBottom: 28,
              }}
            >
              Plan and usage below are real, and upgrade buttons call a real checkout endpoint — but Stripe itself
              isn't configured yet, so clicking Upgrade will say so rather than charge anything. Reach out directly
              if you need a paid plan today.
            </div>

            {isLoading || !data ? (
              <p style={{ fontSize: 13, color: "var(--text-dimmer)" }}>Loading…</p>
            ) : (
              <>
                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)" }}>
                  CURRENT PLAN
                </div>
                <div
                  style={{
                    marginTop: 16,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 20,
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                  }}
                >
                  <div>
                    <div style={{ font: "500 20px/1 Inter, sans-serif", textTransform: "capitalize" }}>
                      {data.limits[data.plan].label}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                      {data.limits[data.plan].priceUsd === 0 ? "$0/mo" : `$${data.limits[data.plan].priceUsd}/mo`}
                    </div>
                  </div>
                  <div style={{ width: 1, height: 36, background: "var(--border-soft)" }} />
                  <div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>
                      {data.usage.sites}
                      {data.limits[data.plan].sites !== null && (
                        <span style={{ fontSize: 13, color: "var(--text-dimmer)", fontWeight: 500 }}>
                          {" "}
                          / {data.limits[data.plan].sites}
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)", letterSpacing: "0.08em", marginTop: 4 }}>
                      SITES
                    </div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>
                      {data.usage.runsThisMonth}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)", letterSpacing: "0.08em", marginTop: 4 }}>
                      RUNS THIS MONTH
                    </div>
                  </div>
                </div>

                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginTop: 36 }}>
                  PLANS
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 16 }}>
                  {TIER_ORDER.map((tier) => {
                    const limit = data.limits[tier];
                    const isCurrent = tier === data.plan;
                    return (
                      <div
                        key={tier}
                        style={{
                          border: isCurrent ? "1px solid var(--accent)" : "1px solid var(--border)",
                          borderRadius: 6,
                          padding: 18,
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ font: "500 14px/1 Inter, sans-serif", color: isCurrent ? "var(--accent-text)" : "var(--text)" }}>
                            {limit.label}
                          </div>
                          {isCurrent && (
                            <span
                              className="mono"
                              style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 4, padding: "2px 6px" }}
                            >
                              CURRENT
                            </span>
                          )}
                        </div>
                        <div className="mono" style={{ fontWeight: 700, fontSize: 26, marginTop: 10 }}>
                          {limit.priceUsd === 0 ? "$0" : <>${limit.priceUsd}<span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>/mo</span></>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-dimmer)", marginTop: 10, lineHeight: 1.5, flex: 1 }}>
                          {TIER_FEATURES[tier]}
                        </div>
                        {isCurrent ? (
                          <button
                            disabled
                            style={{
                              marginTop: 16,
                              font: "500 12px/1 Inter, sans-serif",
                              color: "var(--text-dimmer)",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              padding: "9px 12px",
                              background: "transparent",
                              cursor: "default",
                            }}
                          >
                            Current plan
                          </button>
                        ) : TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(data.plan) ? (
                          <button
                            disabled
                            title="Contact us to downgrade"
                            style={{
                              marginTop: 16,
                              font: "500 12px/1 Inter, sans-serif",
                              color: "var(--text-dimmer)",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              padding: "9px 12px",
                              background: "transparent",
                              cursor: "not-allowed",
                            }}
                          >
                            Downgrade
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpgrade(tier as "pro" | "agency")}
                            disabled={checkoutBusy === tier}
                            style={{
                              marginTop: 16,
                              font: "500 12px/1 Inter, sans-serif",
                              color: "var(--accent-text)",
                              border: "1px solid var(--accent)",
                              borderRadius: 6,
                              padding: "9px 12px",
                              background: "transparent",
                              opacity: checkoutBusy === tier ? 0.6 : 1,
                            }}
                          >
                            {checkoutBusy === tier ? "Starting…" : `Upgrade to ${limit.label}`}
                          </button>
                        )}
                        {checkoutState?.tier === tier && (
                          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dimmer)", lineHeight: 1.4 }}>
                            {checkoutState.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
