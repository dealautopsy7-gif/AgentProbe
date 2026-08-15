import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import {
  fetchClients,
  addClient,
  deleteClient,
  assignSiteToClient,
  updateClientBrand,
  generateClientReport,
  publicReportUrl,
  ApiError,
  type ClientRow,
  type ClientSiteSummary,
} from "../lib/api";

const scoreColor = (score: number) => (score >= 80 ? "#30A46C" : score >= 60 ? "#F5A524" : "#E5484D");

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>—</span>;
  }
  return (
    <span className="mono" style={{ fontWeight: 700, fontSize: 18, color: scoreColor(score), letterSpacing: "-0.02em" }}>
      {score}
    </span>
  );
}

function SiteRow({
  site,
  clients,
  currentClientId,
  onReassigned,
}: {
  site: ClientSiteSummary;
  clients: ClientRow[];
  currentClientId: string | null;
  onReassigned: () => void;
}) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function reassign(clientId: string | null) {
    if (!session) return;
    setBusy(true);
    try {
      await assignSiteToClient(session.access_token, site.id, clientId);
      onReassigned();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: "1px solid rgba(233,233,237,.08)" }}>
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => navigate(`/sites/${site.id}`)}>
        <div style={{ font: "500 13px/1.2 Inter, sans-serif" }}>{site.label || site.url}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{site.url.replace(/^https?:\/\//, "")}</div>
      </div>
      <ScoreBadge score={site.latestScore} />
      <select
        className="mono"
        value={currentClientId ?? ""}
        disabled={busy}
        onChange={(e) => reassign(e.target.value || null)}
        style={{ height: 32, border: "1px solid var(--border)", borderRadius: 5, background: "var(--field)", padding: "0 8px", color: "var(--text)", fontSize: 12 }}
      >
        <option value="">Unassigned</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

function ClientCard({ client, allClients, onChanged }: { client: ClientRow; allClients: ClientRow[]; onChanged: () => void }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportResult, setReportResult] = useState<{ url: string } | { error: string; upgrade: boolean } | null>(null);

  async function remove() {
    if (!session) return;
    setDeleting(true);
    try {
      await deleteClient(session.access_token, client.id);
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function changeBrandColor(color: string) {
    if (!session) return;
    await updateClientBrand(session.access_token, client.id, color);
    onChanged();
  }

  async function generateReport() {
    if (!session) return;
    setGenerating(true);
    setReportResult(null);
    try {
      const { slug } = await generateClientReport(session.access_token, client.id);
      const url = publicReportUrl(slug);
      setReportResult({ url });
      window.open(url, "_blank");
    } catch (err) {
      const isUpgrade = err instanceof ApiError && err.status === 403;
      setReportResult({ error: err instanceof Error ? err.message : "Failed to generate report", upgrade: isUpgrade });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", background: "var(--panel-alt)", borderBottom: "1px solid var(--border-soft)" }}>
        <input
          type="color"
          value={client.brandColor ?? "#968ae0"}
          onChange={(e) => changeBrandColor(e.target.value)}
          title="Brand color for this client's public report"
          style={{ width: 26, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 5, background: "transparent", cursor: "pointer", flex: "none" }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ font: "500 15px/1.2 Inter, sans-serif" }}>{client.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
            {client.sites.length} {client.sites.length === 1 ? "site" : "sites"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <ScoreBadge score={client.averageScore} />
          <div className="mono" style={{ fontSize: 10, color: "var(--text-dimmer)", letterSpacing: "0.08em", marginTop: 2 }}>AVG SCORE</div>
        </div>
        <button
          onClick={generateReport}
          disabled={generating}
          style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "8px 12px", background: "transparent", opacity: generating ? 0.6 : 1 }}
        >
          {generating ? "Generating…" : "Generate report"}
        </button>
        <button
          onClick={remove}
          disabled={deleting}
          style={{ font: "500 12px/1 Inter, sans-serif", color: "#E5484D", border: "1px solid rgba(229,72,77,.4)", borderRadius: 6, padding: "8px 12px", background: "transparent", opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? "Removing…" : "Remove"}
        </button>
      </div>
      {reportResult && (
        <div style={{ padding: "12px 20px", fontSize: 12, borderBottom: "1px solid rgba(233,233,237,.08)" }}>
          {"url" in reportResult ? (
            <span style={{ color: "var(--text-dim)" }}>
              Report link: <a href={reportResult.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>{reportResult.url}</a>
            </span>
          ) : (
            <span style={{ color: "#E5484D" }}>
              {reportResult.error}
              {reportResult.upgrade && (
                <>
                  {" "}
                  <span style={{ color: "var(--accent-text)", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/billing")}>
                    Upgrade
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      )}
      {client.sites.length === 0 ? (
        <p style={{ padding: 20, fontSize: 13, color: "var(--text-dimmer)" }}>No sites assigned yet — assign one from the unassigned list below.</p>
      ) : (
        client.sites.map((site) => (
          <SiteRow key={site.id} site={site} clients={allClients} currentClientId={client.id} onReassigned={onChanged} />
        ))
      )}
    </div>
  );
}

export function Clients() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [newClientName, setNewClientName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchClients(session!.access_token),
    enabled: Boolean(session),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["clients"] });

  async function handleAddClient() {
    if (!session || !newClientName.trim()) return;
    setCreating(true);
    try {
      await addClient(session.access_token, newClientName.trim());
      setNewClientName("");
      refresh();
    } finally {
      setCreating(false);
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
        <Sidebar active="Clients" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: 56, borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", padding: "0 32px", gap: 12 }}>
            <span style={{ font: "500 15px/1 Inter, sans-serif" }}>Clients</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddClient()}
                placeholder="New client name"
                style={{ height: 34, width: 200, padding: "0 10px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, color: "var(--text)" }}
              />
              <button
                onClick={handleAddClient}
                disabled={creating || !newClientName.trim()}
                style={{ font: "500 12px/1 Inter, sans-serif", color: "var(--accent-text)", border: "1px solid var(--accent)", borderRadius: 6, padding: "0 14px", background: "transparent", opacity: creating || !newClientName.trim() ? 0.6 : 1 }}
              >
                {creating ? "Adding…" : "Add client"}
              </button>
            </div>
          </div>

          <div style={{ padding: 32 }}>
            {isLoading || !data ? (
              <p style={{ fontSize: 13, color: "var(--text-dimmer)" }}>Loading…</p>
            ) : (
              <>
                {data.clients.length === 0 && data.unassignedSites.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-dimmer)" }}>
                    No clients or sites yet. Add a client above once you've run your first test.
                  </p>
                ) : (
                  <>
                    {data.clients.map((client) => (
                      <ClientCard key={client.id} client={client} allClients={data.clients} onChanged={refresh} />
                    ))}

                    <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dimmer)", marginTop: 8 }}>
                      UNASSIGNED SITES
                    </div>
                    <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                      {data.unassignedSites.length === 0 ? (
                        <p style={{ padding: 20, fontSize: 13, color: "var(--text-dimmer)" }}>Every site is assigned to a client.</p>
                      ) : (
                        data.unassignedSites.map((site) => (
                          <SiteRow key={site.id} site={site} clients={data.clients} currentClientId={null} onReassigned={refresh} />
                        ))
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
