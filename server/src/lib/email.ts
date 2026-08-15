import { getEnv } from "../config/env.js";

/**
 * Sends via the Resend REST API directly (no SDK needed for one call type).
 * Returns whether an email was actually sent. Without RESEND_API_KEY this
 * logs what *would* have been sent and returns false — the honest
 * not-yet-real state, same pattern as video/fix generation elsewhere,
 * rather than silently pretending delivery happened.
 */
export async function sendAlertEmail(input: {
  to: string;
  siteLabel: string;
  oldScore: number;
  newScore: number;
}): Promise<boolean> {
  const env = getEnv();
  const subject = `AgentProbe: ${input.siteLabel} dropped from ${input.oldScore} to ${input.newScore}`;
  const body = `Your monitored site ${input.siteLabel} scored ${input.newScore}/100 on its latest scan, down from ${input.oldScore}. Log in to AgentProbe to see what changed.`;

  if (!env.RESEND_API_KEY) {
    console.log(`[email] Resend not configured — would send to ${input.to}: "${subject}"`);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: input.to,
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    console.error(`[email] Resend send failed (${res.status}):`, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
