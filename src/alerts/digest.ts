import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { alertRecipients } from "@/auth/users";
import { displayScore } from "@/scoring";

/**
 * The daily digest: one email after the market close with the day's top
 * signals and what the user's held positions did.
 *
 * Rides the same optional Resend configuration as alerts. Without a key this
 * simply never sends — there is no in-app equivalent because the feed with
 * "Newest" IS the in-app digest.
 */

type DigestSignal = {
  symbol: string | null;
  sector: string | null;
  direction: string;
  live: number;
  rationale: string;
  title: string;
  url: string;
};

type HeldMove = {
  symbol: string;
  close: number;
  prevClose: number | null;
};

async function rows<T>(statement: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db().execute(statement)) as unknown as T[] | { rows: T[] };
  return Array.isArray(r) ? r : (r.rows ?? []);
}

export async function sendDailyDigestIfConfigured(): Promise<{
  sent: boolean;
  skipped: string | null;
}> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, skipped: "RESEND_API_KEY not set" };

  // Everyone with alerts enabled, not one hard-coded address.
  const to = await alertRecipients();
  if (to.length === 0) return { sent: false, skipped: "no digest recipients" };

  const top = await rows<DigestSignal>(sql`
    select sg.symbol, sg.sector, sg.direction,
           coalesce(sg.base_score, sg.score)
             * power(0.5, greatest(extract(epoch from (now() - i.published_at)) / 3600.0, 0)
               / case sg.horizon when 'days' then 36.0 when 'weeks' then 168.0
                                 when 'months' then 720.0 else 72.0 end) as live,
           sg.rationale, i.title, i.canonical_url as url
    from signals sg
    join items i on i.id = sg.item_id
    where sg.model <> 'rules' and sg.created_at >= now() - interval '24 hours'
    order by 4 desc limit 5`);

  const held = await rows<HeldMove>(sql`
    select w.symbol,
           (select close from prices p where p.symbol = w.symbol
              order by market_date desc limit 1)::float as close,
           (select close from prices p where p.symbol = w.symbol
              order by market_date desc offset 1 limit 1)::float as prev_close
    from watchlist w where w.is_owned
    order by w.symbol`);

  if (top.length === 0 && held.length === 0) {
    return { sent: false, skipped: "nothing to report" };
  }

  const signalRows = top
    .map((s) => {
      const shown = displayScore(Number(s.live));
      const name = s.symbol ?? s.sector ?? "—";
      return (
        `<tr><td style="padding:5px 10px;font-weight:600">${shown}</td>` +
        `<td style="padding:5px 10px">${name}</td>` +
        `<td style="padding:5px 10px;color:${s.direction === "bullish" ? "#127a4b" : s.direction === "bearish" ? "#b42318" : "#667085"}">${s.direction}</td>` +
        `<td style="padding:5px 10px"><a href="${s.url}">${esc(s.title.slice(0, 80))}</a></td></tr>`
      );
    })
    .join("");

  const heldRows = held
    .map((h) => {
      const prev = h.prevClose ?? null;
      const pct =
        prev && prev > 0 ? (((h.close - prev) / prev) * 100).toFixed(2) : null;
      return (
        `<tr><td style="padding:5px 10px;font-weight:600">${h.symbol}</td>` +
        `<td style="padding:5px 10px">$${h.close?.toFixed(2) ?? "—"}</td>` +
        `<td style="padding:5px 10px;color:${pct === null ? "#667085" : Number(pct) >= 0 ? "#127a4b" : "#b42318"}">${pct === null ? "—" : `${Number(pct) >= 0 ? "+" : ""}${pct}%`}</td></tr>`
      );
    })
    .join("");

  const appUrl = process.env.APP_URL ?? "";
  const html =
    `<h3 style="font-family:system-ui">Signal Desk — daily digest</h3>` +
    (top.length
      ? `<p style="font-family:system-ui;font-size:13px">Top signals, last 24h:</p>` +
        `<table style="border-collapse:collapse;font-family:system-ui;font-size:13px">${signalRows}</table>`
      : "") +
    (held.length
      ? `<p style="font-family:system-ui;font-size:13px">Your positions:</p>` +
        `<table style="border-collapse:collapse;font-family:system-ui;font-size:13px">${heldRows}</table>`
      : "") +
    `<p style="font-family:system-ui;color:#667085;font-size:12px">Research prompts, not recommendations.` +
    (appUrl ? ` <a href="${appUrl}">Open Signal Desk</a>` : "") +
    `</p>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM ?? "Signal Desk <onboarding@resend.dev>",
      to,
      subject: `Signal Desk digest — ${top.length} top signal(s)`,
      html,
    }),
  });

  if (!response.ok) {
    console.error(`[digest] email failed: HTTP ${response.status}`);
    return { sent: false, skipped: `resend HTTP ${response.status}` };
  }
  return { sent: true, skipped: null };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
