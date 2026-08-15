export interface ReportSiteView {
  label: string;
  url: string;
  latestScore: number | null;
  fixes: { severity: "critical" | "high" | "medium"; problem: string; likelyCause: string | null; suggestedFix: string }[];
}

export interface PublicClientReportView {
  clientName: string;
  brandColor: string | null;
  averageScore: number | null;
  sites: ReportSiteView[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bandFor(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "PENDING", color: "#8a8a92" };
  if (score >= 80) return { label: "PASS BAND · 80–100", color: "#30A46C" };
  if (score >= 60) return { label: "WATCH BAND · 60–79", color: "#F5A524" };
  return { label: "FAIL BAND · 0–59", color: "#E5484D" };
}

const SEVERITY_COLOR: Record<string, string> = { critical: "#E5484D", high: "#F5A524", medium: "#968ae0" };

/**
 * Server-rendered, live-queried at request time (not a frozen snapshot
 * generated once) — same reasoning as renderPublicRunPage: this is the
 * canonical page a client-facing report link points at, so it needs to
 * reflect the account's current data, not whatever it looked like the
 * moment "Generate report" was clicked. Fixes/scores that don't exist yet
 * for a site show an honest "no test run yet" rather than a fabricated one.
 */
export function renderClientReportPage(data: PublicClientReportView, canonicalUrl: string, frontendUrl: string): string {
  const brand = data.brandColor && /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#968ae0";
  const band = bandFor(data.averageScore);
  const title = `${escapeHtml(data.clientName)} — agent-readiness report`;
  const description =
    data.sites.length === 0
      ? `A readiness report for ${escapeHtml(data.clientName)}.`
      : `${data.sites.length} site${data.sites.length === 1 ? "" : "s"} tested for ${escapeHtml(data.clientName)}. Average score: ${data.averageScore ?? "—"}/100.`;

  const siteBlocks = data.sites
    .map((site) => {
      const siteBand = bandFor(site.latestScore);
      const fixRows =
        site.fixes.length === 0
          ? '<p class="empty">No fixes recorded for the most recent run.</p>'
          : site.fixes
              .map(
                (f) => `<div class="fix">
        <div class="fix-head"><span class="fix-sev" style="background:${SEVERITY_COLOR[f.severity]}1A;color:${SEVERITY_COLOR[f.severity]};border:1px solid ${SEVERITY_COLOR[f.severity]}80">${f.severity.toUpperCase()}</span><span class="fix-problem">${escapeHtml(f.problem)}</span></div>
        ${f.likelyCause ? `<p class="fix-cause">${escapeHtml(f.likelyCause)}</p>` : ""}
        <pre class="fix-code">${escapeHtml(f.suggestedFix)}</pre>
      </div>`,
              )
              .join("\n");

      return `<div class="site">
      <div class="site-head">
        <div>
          <div class="site-label">${escapeHtml(site.label)}</div>
          <div class="site-url mono">${escapeHtml(site.url.replace(/^https?:\/\//, ""))}</div>
        </div>
        <span class="mono score" style="color:${siteBand.color}">${site.latestScore ?? "—"}</span>
      </div>
      ${site.latestScore === null ? '<p class="empty">No test run yet for this site.</p>' : fixRows}
    </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  body{margin:0;background:#0f1119;color:#e9e9ed;font-family:Inter,system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
  .mono{font-family:'JetBrains Mono',monospace}
  .wrap{max-width:720px;margin:0 auto;padding:56px 24px}
  .brand-bar{height:4px;border-radius:2px;background:${brand};margin-bottom:28px;width:56px}
  .kicker{font-size:11px;letter-spacing:.12em;color:rgba(233,233,237,.45);text-transform:uppercase}
  h1{font:600 30px/1.2 Inter,sans-serif;margin:8px 0 0}
  .score{font-weight:700;font-size:64px;letter-spacing:-0.04em;line-height:1}
  .band{display:inline-flex;align-items:center;gap:8px;border-radius:5px;padding:6px 10px;font-size:11px;font-weight:500;letter-spacing:0.1em;margin-top:14px}
  .summary{margin-top:20px;font-size:14px;color:rgba(233,233,237,.7)}
  .section-label{font-size:11px;letter-spacing:0.12em;color:rgba(233,233,237,.45);margin:44px 0 16px}
  .site{border:1px solid rgba(233,233,237,.14);border-radius:8px;padding:20px;margin-bottom:16px}
  .site-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .site-label{font:500 16px/1.2 Inter,sans-serif}
  .site-url{font-size:11px;color:rgba(233,233,237,.4);margin-top:4px}
  .site .score{font-size:30px}
  .empty{margin:14px 0 0;font-size:13px;color:rgba(233,233,237,.4)}
  .fix{margin-top:16px;padding-top:16px;border-top:1px solid rgba(233,233,237,.08)}
  .fix-head{display:flex;align-items:center;gap:10px}
  .fix-sev{font-size:10px;font-weight:600;letter-spacing:.06em;border-radius:4px;padding:3px 7px}
  .fix-problem{font:500 14px/1.3 Inter,sans-serif}
  .fix-cause{margin:8px 0 0;font-size:13px;color:rgba(233,233,237,.6);line-height:1.5}
  .fix-code{margin:10px 0 0;background:#161826;border:1px solid rgba(233,233,237,.12);border-radius:6px;padding:12px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#b5abfc;white-space:pre-wrap;word-break:break-word}
  .cta{display:inline-block;margin-top:40px;padding:12px 24px;border:1px solid #968ae0;border-radius:6px;color:#b5abfc;text-decoration:none;font-weight:500}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand-bar"></div>
  <div class="kicker">Agent-readiness report</div>
  <h1>${escapeHtml(data.clientName)}</h1>

  <div style="display:flex;align-items:baseline;gap:12px;margin-top:24px">
    <span class="mono score" style="color:${band.color}">${data.averageScore ?? "—"}</span>
    <span class="mono" style="font-size:16px;color:rgba(233,233,237,.35)">/100 avg</span>
  </div>
  <div class="mono band" style="border:1px solid ${band.color}80;background:${band.color}1A;color:${band.color}">${band.label}</div>
  <p class="summary">${escapeHtml(description)}</p>

  <div class="section-label">SITES</div>
  ${data.sites.length === 0 ? '<p class="empty">No sites assigned to this client yet.</p>' : siteBlocks}

  <a class="cta" href="${escapeHtml(frontendUrl)}">Generated by AgentProbe</a>
</div>
</body>
</html>`;
}
