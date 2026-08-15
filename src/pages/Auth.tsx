import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

type Mode = "signup" | "login";

function targetPath(searchParams: URLSearchParams): string {
  const redirect = searchParams.get("redirect");
  if (redirect) return decodeURIComponent(redirect);
  const url = searchParams.get("url");
  if (url) return `/new-test?url=${encodeURIComponent(url)}`;
  return "/new-test";
}

export function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, signUpWithEmail, signInWithEmail, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "login" ? "login" : "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState(false);

  // Covers both a session that already existed on mount and one that lands
  // after a Google OAuth redirect back to this page.
  useEffect(() => {
    if (session) navigate(targetPath(searchParams), { replace: true });
  }, [session, searchParams, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await signUpWithEmail(email, password);
        if (error) {
          setError(error);
        } else {
          // Supabase requires email confirmation by default; a session may
          // not exist yet, so tell the user rather than silently hanging.
          setConfirmNotice(true);
        }
      } else {
        const { error } = await signInWithEmail(email, password);
        if (error) setError(error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const redirectTo = `${window.location.origin}/auth${window.location.search}`;
    const { error } = await signInWithGoogle(redirectTo);
    if (error) setError(error);
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: "min(1440px, 100%)",
          height: 720,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns: "1fr 520px",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "48px 56px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-soft)" }}>
          <Logo size={18} />
          <div style={{ marginTop: "auto", maxWidth: 460 }}>
            <p style={{ font: "500 26px/1.3 Inter, sans-serif", margin: 0, letterSpacing: "-0.015em" }}>
              Your site looks fine to humans. An agent gave up 31 seconds in.
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border-soft)" }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: 40, color: "#E5484D" }}>2</span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(233,233,237,.55)", maxWidth: 300 }}>
                of every 3 stores we test fail at least one checkout checkpoint on the first run.
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: 48, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
              fontSize: 13,
            }}
          >
            <button
              onClick={() => { setMode("signup"); setError(null); }}
              style={{
                padding: "7px 16px",
                background: "transparent",
                border: "none",
                color: mode === "signup" ? "var(--accent-text)" : "var(--text-dim)",
                boxShadow: mode === "signup" ? "inset 0 0 0 1px var(--accent)" : "none",
              }}
            >
              Create account
            </button>
            <button
              onClick={() => { setMode("login"); setError(null); }}
              style={{
                padding: "7px 16px",
                background: "transparent",
                borderLeft: "1px solid var(--border)",
                border: "none",
                borderLeftWidth: 1,
                color: mode === "login" ? "var(--accent-text)" : "var(--text-dim)",
                boxShadow: mode === "login" ? "inset 0 0 0 1px var(--accent)" : "none",
              }}
            >
              Log in
            </button>
          </div>

          <h2 style={{ font: "500 26px/1.2 Inter, sans-serif", margin: "28px 0 6px" }}>
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h2>
          <p style={{ margin: "0 0 28px", fontSize: 13, color: "var(--text-dimmer)" }}>
            {mode === "signup" ? "Free plan includes one site and one full test." : "Log in to see your sites and run history."}
          </p>

          <button
            onClick={handleGoogle}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              height: 44,
              border: "1px solid rgba(233,233,237,.16)",
              borderRadius: 6,
              font: "500 14px/1 Inter, sans-serif",
              background: "transparent",
              color: "var(--text)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path
                fill="#e9e9ed"
                d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.36-1.65 3.98-5.27 3.98-3.17 0-5.76-2.62-5.76-5.86s2.59-5.86 5.76-5.86c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.79 3.86 14.68 3 12.18 3 7.03 3 2.86 7.17 2.86 12.2s4.17 9.2 9.32 9.2c5.38 0 8.94-3.78 8.94-9.1 0-.61-.07-1.08-.17-1.2z"
              />
            </svg>
            Continue with Google
          </button>

          <div
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0", fontSize: 11, color: "var(--text-faint)" }}
          >
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            OR
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>Work email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mono"
              style={{
                width: "100%",
                height: 44,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--field)",
                padding: "0 12px",
                fontSize: 14,
                color: "var(--text)",
              }}
            />
            <label style={{ display: "block", fontSize: 12, color: "var(--text-dim)", margin: "16px 0 6px" }}>Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="mono"
              style={{
                width: "100%",
                height: 44,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--field)",
                padding: "0 12px",
                fontSize: 14,
                color: "var(--text)",
              }}
            />

            {error && (
              <p style={{ margin: "14px 0 0", fontSize: 12, color: "#E5484D" }}>{error}</p>
            )}
            {confirmNotice && (
              <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--green)" }}>
                Check your email to confirm your account, then log in.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                height: 44,
                marginTop: 22,
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
              {submitting ? "Working…" : mode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>

          <p style={{ margin: "16px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--text-faint)" }}>
            By continuing you agree to the Terms and Privacy Policy. We only load pages you own or have permission to test.
          </p>
        </div>
      </div>
    </div>
  );
}
