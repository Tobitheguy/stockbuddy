import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { alerts, items, signals } from "@/db/schema";
import { displayScore } from "@/scoring";

/**
 * Alert rules.
 *
 * Two bars, both expressed on the DISPLAYED scale because that is the scale
 * the user reads and reasons in:
 *
 *   62+ (Rare)               any symbol — the top-of-month kind of event.
 *   49+ (Strong) on a held   lower bar on purpose. A strong signal on a
 *                            position the user holds is exposure, and being
 *                            told about it late defeats the point of holding
 *                            a research tool at all.
 *
 * Neutral direction never alerts: an interruption must carry a directional
 * claim worth reacting to. The signal itself still appears in the feed.
 */

export const RARE_ALERT_MIN = 62;
export const HELD_ALERT_MIN = 49;

export function alertReasonFor(
  rawScore: number,
  direction: string,
  symbol: string | null,
  owned: ReadonlySet<string>,
): "rare" | "held_strong" | null {
  if (direction === "neutral") return null;
  const shown = displayScore(rawScore);
  if (shown >= RARE_ALERT_MIN) return "rare";
  if (symbol && owned.has(symbol) && shown >= HELD_ALERT_MIN) {
    return "held_strong";
  }
  return null;
}

export async function recordAlert(
  signalId: number,
  reason: "rare" | "held_strong",
): Promise<void> {
  await db()
    .insert(alerts)
    .values({ signalId, reason })
    .onConflictDoNothing({ target: alerts.signalId });
}

export type PendingAlert = {
  alertId: number;
  reason: "rare" | "held_strong";
  symbol: string | null;
  sector: string | null;
  direction: string;
  score: number;
  rationale: string;
  title: string;
  url: string;
};

/** Alerts not yet emailed, oldest first so a batch reads chronologically. */
export async function pendingEmailAlerts(): Promise<PendingAlert[]> {
  const rows = await db()
    .select({
      alertId: alerts.id,
      reason: alerts.reason,
      symbol: signals.symbol,
      sector: signals.sector,
      direction: signals.direction,
      score: signals.score,
      rationale: signals.rationale,
      title: items.title,
      url: items.canonicalUrl,
    })
    .from(alerts)
    .innerJoin(signals, eq(signals.id, alerts.signalId))
    .innerJoin(items, eq(items.id, signals.itemId))
    .where(and(isNull(alerts.emailedAt)))
    .orderBy(alerts.createdAt)
    .limit(50);

  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

export async function markEmailed(alertIds: number[]): Promise<void> {
  if (alertIds.length === 0) return;
  await db()
    .update(alerts)
    .set({ emailedAt: new Date() })
    .where(sql`${alerts.id} in ${alertIds}`);
}
