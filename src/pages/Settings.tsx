import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { deleteAccount } from "../lib/api";

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginBottom: 16 }}>
      {children}
    </div>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { session, user, updateProfileName, signOut } = useAuth();
  const [name, setName] = useState<string>((user?.user_metadata?.name as string | undefined) ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function saveName() {
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    const { error } = await updateProfileName(name.trim());
    if (error) setNameError(error);
    else setNameSaved(true);
    setSavingName(false);
  }

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(session.access_token);
      await signOut();
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
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
        <Sidebar active="Settings" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px" }}>
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Settings</span>
          </div>

          <div style={{ padding: 32, maxWidth: 620 }}>
            <SectionLabel>PROFILE</SectionLabel>
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 20, marginBottom: 36 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                <label className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)" }}>NAME</label>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameSaved(false);
                  }}
                  placeholder="Add your name"
                  style={{ height: 40, padding: "0 12px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, color: "var(--text)" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                <label className="mono" style={{ fontSize: 11, color: "var(--text-dimmer)" }}>EMAIL</label>
                <div className="mono" style={{ height: 40, display: "flex", alignItems: "center", padding: "0 12px", background: "var(--panel-deep)", border: "1px solid var(--border-soft)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
                  {user?.email}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={saveName}
                  disabled={savingName}
                  style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "9px 14px", background: "transparent", opacity: savingName ? 0.6 : 1 }}
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                {nameSaved && <span style={{ fontSize: 12, color: "#30A46C" }}>Saved</span>}
                {nameError && <span style={{ fontSize: 12, color: "#E5484D" }}>{nameError}</span>}
              </div>
            </div>

            <SectionLabel>ALERT CHANNELS</SectionLabel>
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 36 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: "1px solid rgba(233,233,237,.08)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "500 14px/1.2 Inter, sans-serif" }}>Email</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{user?.email}</div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: "0.08em", color: "#30A46C", border: "1px solid rgba(48,164,108,.4)", borderRadius: 4, padding: "3px 8px" }}
                >
                  CONNECTED
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "500 14px/1.2 Inter, sans-serif", color: "var(--text-dim)" }}>Slack</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Not built yet</div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-dimmer)", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 8px" }}
                >
                  NOT CONNECTED
                </span>
              </div>
            </div>

            <SectionLabel>API ACCESS</SectionLabel>
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "16px 20px", marginBottom: 36, fontSize: 13, color: "var(--text-dimmer)", lineHeight: 1.5 }}>
              AgentProbe doesn't have a public API yet — there's no key to show here. This section will show a
              generated key once a v1 API ships.
            </div>

            <SectionLabel>DANGER ZONE</SectionLabel>
            <div style={{ border: "1px solid rgba(229,72,77,.35)", borderRadius: 6, padding: 20 }}>
              {!confirmingDelete ? (
                <>
                  <div style={{ font: "500 14px/1.2 Inter, sans-serif" }}>Delete account</div>
                  <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                    Permanently deletes your account and every site, run, video, and schedule you own. This cannot be
                    undone.
                  </p>
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    style={{ font: "500 12px/1 Inter, sans-serif", color: "#E5484D", border: "1px solid rgba(229,72,77,.4)", borderRadius: 6, padding: "9px 14px", background: "transparent" }}
                  >
                    Delete account
                  </button>
                </>
              ) : (
                <>
                  <div style={{ font: "500 14px/1.2 Inter, sans-serif", color: "#E5484D" }}>Are you sure?</div>
                  <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                    Type <span className="mono" style={{ color: "var(--text)" }}>delete</span> to confirm. This cannot be undone.
                  </p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      placeholder="delete"
                      className="mono"
                      style={{ height: 38, width: 160, padding: "0 12px", background: "var(--field)", border: "1px solid rgba(229,72,77,.4)", borderRadius: 6, fontSize: 13, color: "var(--text)" }}
                    />
                    <button
                      onClick={handleDelete}
                      disabled={deleteInput !== "delete" || deleting}
                      style={{
                        font: "500 12px/1 Inter, sans-serif",
                        color: "#fff",
                        border: "1px solid #E5484D",
                        borderRadius: 6,
                        padding: "9px 14px",
                        background: deleteInput === "delete" ? "#E5484D" : "transparent",
                        opacity: deleteInput === "delete" && !deleting ? 1 : 0.5,
                      }}
                    >
                      {deleting ? "Deleting…" : "Permanently delete"}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmingDelete(false);
                        setDeleteInput("");
                        setDeleteError(null);
                      }}
                      style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 14px", background: "transparent" }}
                    >
                      Cancel
                    </button>
                  </div>
                  {deleteError && <p style={{ marginTop: 10, fontSize: 12, color: "#E5484D" }}>{deleteError}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
