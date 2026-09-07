import { displayScore } from "@/scoring";
import { markEmailed, pendingEmailAlerts } from "./engine";

/**
 * Email delivery via Resend — entirely optional.
 *
 * Without RESEND_API_KEY, nothing here runs and nothing is lost: alerts live
 * in the database and the /alerts page shows them. With a key (Resend's free
 * tier is 100 emails/day, which this will never approach), each processing
 * run that produced alerts sends ONE summary email rather than one per
 * signal — an inbox full of single-signal emails trains the user to ignore
 * them, which is worse than no email at all.
 *
 * Failures are logged and the alerts stay unmarked, so the next run retries.
 */

const FROM_FALLBACK = "Signal Desk <onboarding@resend.dev>";

export async function sendAlertEmailIfConfigured(): Promise<{
  sent: number;
  skipped: string | null;
}> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_EMAIL;
  if (!key) return { sent: 0, skipped: "RESEND_API_KEY not set" };
  if (!to) return { sent: 0, skipped: "ADMIN_EMAIL not set" };

  const pending = await pendingEmailAlerts();
  if (pending.length === 0) return { sent: 0, skipped: null };

  const appUrl = process.env.APP_URL ?? "";
  const lines = pending.map((a) => {
    const shown = displayScore(a.score);
    const name = a.symbol ?? a.sector ?? "—";
    const badge = a.reason === "held_strong" ? " [YOUR POSITION]" : "";
    return (
      `<tr>` +
      `<td style="padding:6px 10px;font-weight:600">${shown}</td>` +
      `<td style="padding:6px 10px">${name}${badge}</td>` +
      `<td style="padding:6px 10px;color:${a.direction === "bullish" ? "#127a4b" : "#b42318"}">${a.direction}</td>` +
      `<td style="padding:6px 10px"><a href="${a.url}">${escapeHtml(a.title.slice(0, 90))}</a><br/>` +
      `<span style="color:#667085;font-size:12px">${escapeHtml(a.rationale.slice(0, 220))}</span></td>` +
      `</tr>`
    );
  });

  const html =
    `<p>${pending.length} signal(s) crossed the alert bar.</p>` +
    `<table style="border-collapse:collapse;font-family:system-ui;font-size:14px">${lines.join("")}</table>` +
    `<p style="color:#667085;font-size:12px">Research prompts, not recommendations. ` +
    (appUrl ? `<a href="${appUrl}/alerts">All alerts</a>` : "") +
    `</p>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM ?? FROM_FALLBACK,
      to: [to],
      subject: `Signal Desk: ${pending.length} alert(s) — top ${displayScore(Math.max(...pending.map((p) => p.score)))}`,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[alerts] email failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
    return { sent: 0, skipped: `resend HTTP ${response.status}` };
  }

  await markEmailed(pending.map((p) => p.alertId));
  return { sent: pending.length, skipped: null };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
