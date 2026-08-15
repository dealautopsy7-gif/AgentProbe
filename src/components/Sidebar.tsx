import { useNavigate } from "react-router-dom";
import { Logo } from "./Logo";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS: { label: string; to: string | null }[] = [
  { label: "New test", to: "/new-test" },
  { label: "Dashboard", to: "/dashboard" },
  { label: "Clients", to: "/clients" },
  { label: "Monitoring", to: "/monitoring" },
  { label: "Billing", to: "/billing" },
  { label: "Settings", to: "/settings" },
];

function initialsFor(email: string) {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0]?.[0], parts[1]?.[0]] : [name[0], name[1]];
  return chars.filter(Boolean).join("").toUpperCase() || "?";
}

export function Sidebar({ active }: { active: string }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const email = user?.email ?? "";

  async function handleSignOut() {
    await signOut();
    navigate("/auth", { replace: true });
  }

  return (
    <div
      style={{
        borderRight: "1px solid var(--border-soft)",
        display: "flex",
        flexDirection: "column",
        padding: "18px 0",
        background: "var(--panel-alt)",
      }}
    >
      <div style={{ padding: "0 18px 20px" }}>
        <Logo size={18} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px" }}>
        {NAV_ITEMS.map(({ label, to }) => {
          const isActive = label === active;
          return (
            <div
              key={label}
              onClick={to ? () => navigate(to) : undefined}
              style={{
                padding: "9px 10px",
                borderRadius: 5,
                fontSize: 13,
                background: isActive ? "#232532" : "transparent",
                color: isActive ? "var(--text)" : "var(--text-dim)",
                boxShadow: isActive ? "inset 0 0 0 1px rgba(233,233,237,.10)" : "none",
                cursor: to ? "pointer" : "default",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
      <button
        onClick={handleSignOut}
        title="Sign out"
        style={{
          marginTop: "auto",
          padding: "14px 18px",
          borderTop: "1px solid var(--border-soft)",
          border: "none",
          borderTopStyle: "solid",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div
          className="mono"
          style={{
            width: 26,
            height: 26,
            borderRadius: 4,
            background: "#2c2f3d",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 500,
            color: "rgba(233,233,237,.7)",
            flex: "none",
          }}
        >
          {email ? initialsFor(email) : "?"}
        </div>
        <div style={{ lineHeight: 1.3, overflow: "hidden" }}>
          <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email || "Not signed in"}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 3 }}>
            SIGN OUT
          </div>
        </div>
      </button>
    </div>
  );
}
