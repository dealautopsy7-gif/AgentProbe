import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "../components/Logo";
import { fetchPublicSamples } from "../lib/api";

const scoreColor = (score: number) => (score >= 80 ? "#30A46C" : score >= 60 ? "#F5A524" : "#E5484D");

export function Landing() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");

  const { data: samples, isLoading } = useQuery({
    queryKey: ["public-samples"],
    queryFn: fetchPublicSamples,
    retry: false,
  });

  function runFreeTest() {
    navigate(url.trim() ? `/auth?url=${encodeURIComponent(url.trim())}` : "/auth");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", alignItems: "center", padding: "32px 16px" }}>
      <div style={{ width: "min(1440px, 100%)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, padding: "0 40px", height: 60, borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ marginRight: "auto" }}>
            <Logo size={18} />
          </div>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>How it works</span>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Sample results</span>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Pricing</span>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Docs</span>
          <span onClick={() => navigate("/auth?mode=login")} style={{ fontSize: 13, color: "rgba(233,233,237,.85)", marginLeft: 12, cursor: "pointer" }}>
            Log in
          </span>
          <button
            onClick={() => navigate("/auth")}
            style={{ font: "500 13px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "8px 14px", background: "transparent" }}
          >
            Start free
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: 56, padding: "64px 40px 56px" }}>
          <div style={{ paddingTop: 16 }}>
            <div
              className="mono"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 5, padding: "5px 10px", fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", color: "var(--text-dim)" }}
            >
              AGENT-READINESS TESTING
            </div>
            <h1 style={{ font: "500 52px/1.06 Inter, sans-serif", letterSpacing: "-0.025em", margin: "20px 0 0", maxWidth: 560 }}>
              Can an AI agent actually buy from your store?
            </h1>
            <p style={{ margin: "18px 0 0", maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: "rgba(233,233,237,.66)" }}>
              We send a real agent to your site and make it try. You get a score, a video of exactly where it gave up, and the fix.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 32, maxWidth: 540 }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runFreeTest()}
                placeholder="https://yourstore.com"
                className="mono"
                style={{ flex: 1, height: 46, padding: "0 14px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, color: "var(--text)" }}
              />
              <button
                onClick={runFreeTest}
                style={{ height: 46, padding: "0 20px", border: "1px solid var(--accent)", borderRadius: 6, font: "500 14px/1 Inter, sans-serif", color: "var(--accent-text)", background: "transparent", whiteSpace: "nowrap" }}
              >
                Run free test
              </button>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12, color: "var(--text-dimmer)" }}>
              <span>No signup for the first run</span>
              <span>·</span>
              <span>Results in ~90 seconds</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 32, marginTop: 56, paddingTop: 28, borderTop: "1px solid var(--border-soft)" }}>
              <div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 46, color: "#E5484D", letterSpacing: "-0.03em" }}>41</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)", letterSpacing: "0.1em", marginTop: 8 }}>BEFORE FIXES</div>
              </div>
              <svg width="72" height="14" viewBox="0 0 72 14" fill="none">
                <path d="M0 7h64M58 2l6 5-6 5" stroke="rgba(233,233,237,.35)" strokeWidth="1.2" />
              </svg>
              <div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 46, color: "#30A46C", letterSpacing: "-0.03em" }}>92</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)", letterSpacing: "0.1em", marginTop: 8 }}>AFTER 3 FIXES</div>
              </div>
              <p style={{ margin: "0 0 0 8px", maxWidth: 230, fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>
                Three common issues — an undismissable cookie banner, missing stock text, an unlabelled button — are enough to move a store into the fail band.
              </p>
            </div>
          </div>

          <div style={{ background: "var(--panel-deep)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", alignSelf: "start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 12px", borderBottom: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3f424d" }} />
              </div>
              <div className="mono" style={{ flex: 1, height: 20, borderRadius: 4, background: "#1b1d29", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10, color: "var(--text-dimmer)" }}>
                yourstore.com/products/…
              </div>
              <div className="mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 500, color: "var(--cyan)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)", animation: "ap-pulse 1.4s infinite" }} />
                AGENT LIVE
              </div>
            </div>
            <div style={{ position: "relative", height: 260, padding: 16, background: "#191b27" }}>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ width: 130, height: 100, borderRadius: 4, background: "repeating-linear-gradient(135deg,#232532,#232532 6px,#1e2029 6px,#1e2029 12px)" }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ height: 14, width: "70%", borderRadius: 3, background: "#2c2f3d" }} />
                  <div style={{ position: "relative", alignSelf: "flex-start", padding: "6px 10px", border: "1px solid var(--cyan)", borderRadius: 4 }}>
                    <div style={{ height: 10, width: 64, borderRadius: 2, background: "#2c2f3d" }} />
                  </div>
                  <div style={{ height: 10, width: "50%", borderRadius: 3, background: "#232532" }} />
                </div>
              </div>
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 46, display: "flex", gap: 10 }}>
                <div style={{ height: 32, flex: 1, border: "1px solid var(--cyan)", borderRadius: 4, display: "flex", alignItems: "center", padding: "0 12px", font: "500 11px/1 Inter, sans-serif", color: "rgba(233,233,237,.5)" }}>
                  Add to cart
                </div>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 16px", background: "#20222f", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)", flex: 1 }}>We use cookies to improve your experience.</span>
                <span style={{ font: "500 10px/1 Inter, sans-serif", padding: "6px 10px", border: "1px solid rgba(233,233,237,.2)", borderRadius: 4 }}>Accept all</span>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--border-soft)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-deep)" }}>
              <div className="mono" style={{ fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
                <span style={{ color: "var(--text-faint)" }}>00:12 </span>Found product
              </div>
              <div className="mono" style={{ fontSize: 11, lineHeight: 1.5, color: "#E5484D" }}>
                <span style={{ color: "rgba(229,72,77,.55)" }}>00:31 </span>Cookie banner covering Add to cart
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "8px 40px 56px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingBottom: 16, borderBottom: "1px solid var(--border-soft)" }}>
            <h3 style={{ font: "500 20px/1 Inter, sans-serif", margin: 0 }}>Public results</h3>
            <span style={{ fontSize: 13, color: "var(--text-dimmer)" }}>Recent tests their owners chose to share</span>
          </div>

          {isLoading ? (
            <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-dimmer)" }}>Loading…</p>
          ) : samples && samples.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 20 }}>
              {samples.map((s, i) => (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ font: "500 15px/1.2 Inter, sans-serif" }}>{s.siteLabel}</div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 34, color: scoreColor(s.score), letterSpacing: "-0.02em" }}>{s.score}</div>
                  </div>
                  <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>{s.summary}</p>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-dimmer)" }}>
              No public results yet — run a test and share it to be the first.
            </p>
          )}
        </div>

        <div style={{ padding: "0 40px 56px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 40, paddingTop: 36, borderTop: "1px solid var(--border-soft)" }}>
            <div>
              <h3 style={{ font: "500 22px/1.15 Inter, sans-serif", margin: 0 }}>Test once free. Monitor for the price of one lost order.</h3>
              <span style={{ display: "inline-block", marginTop: 14, fontSize: 13, color: "var(--accent-text)" }}>Compare all plans →</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 16 }}>
                <div style={{ font: "500 13px/1 Inter, sans-serif" }}>Free</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 26, marginTop: 10 }}>$0</div>
                <div style={{ fontSize: 12, color: "var(--text-dimmer)", marginTop: 10, lineHeight: 1.5 }}>1 site · 1 test · public result</div>
              </div>
              <div style={{ border: "1px solid var(--accent)", borderRadius: 6, padding: 16 }}>
                <div style={{ font: "500 13px/1 Inter, sans-serif", color: "var(--accent-text)" }}>Pro</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 26, marginTop: 10 }}>
                  $79<span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>/mo</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dimmer)", marginTop: 10, lineHeight: 1.5 }}>10 sites · weekly scans · history · alerts</div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 16 }}>
                <div style={{ font: "500 13px/1 Inter, sans-serif" }}>Agency</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 26, marginTop: 10 }}>
                  $299<span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>/mo</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dimmer)", marginTop: 10, lineHeight: 1.5 }}>Client workspaces · white-label reports</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "22px 40px", borderTop: "1px solid var(--border-soft)", background: "var(--panel-alt)" }}>
          <span style={{ font: "600 13px/1 Inter, sans-serif", marginRight: "auto" }}>AgentProbe</span>
          <span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>Docs</span>
          <span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>Changelog</span>
          <span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>Status</span>
          <span style={{ fontSize: 12, color: "var(--text-dimmer)" }}>Privacy</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>© 2026</span>
        </div>
      </div>
    </div>
  );
}
