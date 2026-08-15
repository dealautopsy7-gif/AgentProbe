export interface PublicRunView {
  siteLabel: string;
  score: number | null;
  completionRate: number | null;
  attemptsTotal: number | null;
  successCount: number;
  attempts: number;
  checkpoints: { name: string; label: string; passed: boolean | null }[];
  videoUrl: string | null;
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

/**
 * Server-rendered — no client JS required to see the score, checkpoints, or
 * OG tags. This is deliberately the canonical page for a share link, not a
 * redirect shim into the SPA: the whole point is that social crawlers and
 * no-JS clients see real content, not an empty <div id="root">.
 */
export function renderPublicRunPage(data: PublicRunView, canonicalUrl: string, frontendUrl: string): string {
  const band = bandFor(data.score);
  const title = `${escapeHtml(data.siteLabel)} scored ${data.score ?? "—"}/100 on AgentProbe`;
  const description =
    data.score == null
      ? "An AI agent tried to buy from this store."
      : `An AI agent tried to buy from this store. ${data.successCount} of ${data.attempts} attempts reached checkout.`;

  const checkpointRows = data.checkpoints
    .map((cp) => {
      const status = cp.passed == null ? "pending" : cp.passed ? "pass" : "fail";
      const color = status === "pass" ? "#30A46C" : status === "fail" ? "#E5484D" : "rgba(233,233,237,.35)";
      const glyph = status === "pass" ? "&#10003;" : status === "fail" ? "&#10007;" : "&#9679;";
      return `<div class="cp"><span class="cp-glyph" style="color:${color}">${glyph}</span><span>${escapeHtml(cp.label)}</span></div>`;
    })
    .join("\n");

  const videoBlock = data.videoUrl
    ? `<video controls muted style="width:100%;border-radius:6px;border:1px solid rgba(233,233,237,.12)"><source src="${escapeHtml(data.videoUrl)}"></video>`
    : `<div class="empty-video">No recording available for this run.</div>`;

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
  .wrap{max-width:640px;margin:0 auto;padding:56px 24px}
  .logo{display:flex;align-items:center;gap:9px;margin-bottom:40px}
  .logo-mark{width:18px;height:18px;border:1px solid #3DD9EB;border-radius:4px;display:grid;place-items:center}
  .logo-dot{width:5px;height:5px;background:#3DD9EB;border-radius:1px}
  .score{font-weight:700;font-size:96px;letter-spacing:-0.04em;line-height:1}
  .band{display:inline-flex;align-items:center;gap:8px;border-radius:5px;padding:6px 10px;font-size:11px;font-weight:500;letter-spacing:0.1em;margin-top:16px}
  .attempts{margin-top:20px;font-size:14px;color:rgba(233,233,237,.7)}
  .section-label{font-size:11px;letter-spacing:0.12em;color:rgba(233,233,237,.45);margin:40px 0 12px}
  .cp{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(233,233,237,.08);font-size:14px}
  .cp-glyph{width:16px;text-align:center;font-weight:700}
  .empty-video{height:140px;display:grid;place-items:center;background:#161826;border:1px solid rgba(233,233,237,.12);border-radius:6px;color:rgba(233,233,237,.45);font-size:13px}
  .cta{display:inline-block;margin-top:40px;padding:12px 24px;border:1px solid #968ae0;border-radius:6px;color:#b5abfc;text-decoration:none;font-weight:500}
  .cta:hover{color:#d2cefd}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo"><div class="logo-mark"><div class="logo-dot"></div></div><strong>AgentProbe</strong></div>

  <div style="display:flex;align-items:baseline;gap:12px">
    <span class="mono score" style="color:${band.color}">${data.score ?? "—"}</span>
    <span class="mono" style="font-size:20px;color:rgba(233,233,237,.35)">/100</span>
  </div>
  <div class="mono band" style="border:1px solid ${band.color}80;background:${band.color}1A;color:${band.color}">${band.label}</div>
  <p class="attempts">${escapeHtml(data.siteLabel)} — ${data.successCount} of ${data.attempts} attempts reached checkout.</p>

  <div class="section-label">CHECKPOINTS</div>
  ${checkpointRows || '<p style="color:rgba(233,233,237,.45);font-size:13px">No checkpoint data yet.</p>'}

  <div class="section-label">RUN VIDEO</div>
  ${videoBlock}

  <a class="cta" href="${escapeHtml(frontendUrl)}">Run yours — free</a>
</div>
</body>
</html>`;
}

export function renderNotFoundPage(frontendUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Result not found — AgentProbe</title>
<style>
  body{margin:0;background:#0f1119;color:#e9e9ed;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}
  a{color:#b5abfc}
</style>
</head>
<body>
  <div>
    <p>This result isn't available — it may be private, or the link may be wrong.</p>
    <a href="${frontendUrl}">Run your own test — free</a>
  </div>
</body>
</html>`;
}
