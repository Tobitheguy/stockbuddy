import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { prices, scanRuns, signalOutcomes, signals } from "@/db/schema";
import {
  closeNTradingDaysAfter,
  hasOpenGap,
  marketDateFor,
  pctReturn,
} from "./prices";

/**
 * Measure what happened after each signal.
 *
 * This is the part that makes the tool falsifiable. Without it, a feed of
 * confident-sounding rationales is indistinguishable from a feed of correct
 * ones, and there is no way to find out which sources, event types or prompt
 * versions are actually worth reading.
 *
 * Two rules keep the scorecard honest:
 *
 *  1. A signal with no ticker is never measured. Sector signals name no
 *     tradeable instrument, so there is no return to attribute to them.
 *  2. A window overlapping an unresolved price gap is left pending, not
 *     estimated. A missing row normally means "market closed"; if it might
 *     instead mean "our fetch failed", the +5 offset lands on the wrong day
 *     and produces a wrong number that looks exactly like a right one.
 */

/** Horizons measured, in trading days. */
const OFFSETS = [1, 5, 20] as const;

export type OutcomeSummary = {
  runId: number;
  considered: number;
  baselinesSet: number;
  updated: number;
  finalised: number;
  skippedNoBaseline: number;
  skippedOpenGap: number;
  durationMs: number;
};

/** How far back to look for signals still missing a measurement. */
const LOOKBACK_DAYS = 60;

/**
 * Sized for the real volume, which turned out to be ~670 signals on the first
 * full day — at the original 500, the oldest signals would monopolise the
 * batch and anything newer would wait a day for its baseline. A signal stays
 * open for ~20 trading days, so steady state is several thousand open rows.
 */
const BATCH = 3000;

/**
 * The last close on or before a date.
 *
 * "On or before" rather than "on": a signal published after the close, at a
 * weekend, or on a holiday has no same-day price, and the last close before it
 * is the price a reader could actually have acted on.
 */
async function baselineClose(
  symbol: string,
  onOrBefore: string,
): Promise<{ marketDate: string; close: number } | null> {
  const rows = await db()
    .select({ marketDate: prices.marketDate, close: prices.close })
    .from(prices)
    .where(
      and(eq(prices.symbol, symbol), sql`${prices.marketDate} <= ${onOrBefore}`),
    )
    .orderBy(sql`${prices.marketDate} desc`)
    .limit(1);

  if (rows.length === 0) return null;
  return { marketDate: rows[0].marketDate, close: Number(rows[0].close) };
}

export async function runOutcomes(): Promise<OutcomeSummary> {
  const database = db();
  const startedAt = Date.now();

  const [run] = await database
    .insert(scanRuns)
    .values({ kind: "outcomes" })
    .returning({ id: scanRuns.id });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  // Signals that still have something left to measure: either no outcome row
  // yet, or one with a horizon still open. Once all three prices are in, a
  // signal is finished and never looked at again.
  const queue = await database
    .select({
      signalId: signals.id,
      symbol: signals.symbol,
      direction: signals.direction,
      createdAt: signals.createdAt,
      priceAtSignal: signalOutcomes.priceAtSignal,
      price1d: signalOutcomes.price1d,
      price5d: signalOutcomes.price5d,
      price20d: signalOutcomes.price20d,
    })
    .from(signals)
    .leftJoin(signalOutcomes, eq(signalOutcomes.signalId, signals.id))
    .where(
      and(
        isNotNull(signals.symbol),
        sql`${signals.createdAt} >= ${since}`,
        or(
          isNull(signalOutcomes.signalId),
          isNull(signalOutcomes.price1d),
          isNull(signalOutcomes.price5d),
          isNull(signalOutcomes.price20d),
        ),
      ),
    )
    .orderBy(asc(signals.createdAt))
    .limit(BATCH);

  let baselinesSet = 0;
  let updated = 0;
  let finalised = 0;
  let skippedNoBaseline = 0;
  let skippedOpenGap = 0;

  for (const row of queue) {
    const symbol = row.symbol;
    if (!symbol) continue; // guarded by the query; keeps the type narrow

    const signalDate = marketDateFor(row.createdAt);

    const baseline =
      row.priceAtSignal !== null && row.priceAtSignal !== undefined
        ? { marketDate: signalDate, close: Number(row.priceAtSignal) }
        : await baselineClose(symbol, signalDate);

    if (!baseline) {
      // No close on or before the signal — the symbol was added to price
      // tracking after the fact. Nothing to anchor to; try again tomorrow.
      skippedNoBaseline++;
      continue;
    }

    const measured: Record<string, number | null> = {
      price1d: row.price1d === null ? null : Number(row.price1d),
      price5d: row.price5d === null ? null : Number(row.price5d),
      price20d: row.price20d === null ? null : Number(row.price20d),
    };

    /**
     * Only query for offsets that can possibly exist yet. N trading days
     * need at least N calendar days to have elapsed (weekends only ever add
     * days), so a signal from Tuesday cannot have a +20 close and there is no
     * reason to ask the database for one. At steady state — thousands of open
     * signals, most waiting on +20 — this is most of the run's query volume,
     * and it is what keeps the daily cron inside its time limit.
     */
    const ageCalendarDays =
      (Date.now() - row.createdAt.getTime()) / 86_400_000;
    const due = OFFSETS.filter(
      (n) => measured[`price${n}d`] === null && ageCalendarDays >= n,
    );

    const needsBaseline =
      row.priceAtSignal === null || row.priceAtSignal === undefined;
    if (due.length === 0 && !needsBaseline) continue; // nothing can move yet

    // A gap anywhere from the baseline onward makes every offset suspect, not
    // just the one covering the gap: the offsets are counted as rows.
    if (await hasOpenGap(symbol, baseline.marketDate)) {
      skippedOpenGap++;
      continue;
    }

    let progressed = needsBaseline;
    for (const n of due) {
      const hit = await closeNTradingDaysAfter(symbol, baseline.marketDate, n);
      if (hit) {
        measured[`price${n}d`] = hit.close;
        progressed = true;
      }
    }

    // Nothing new to record — the awaited trading day has not happened yet.
    if (!progressed) continue;

    const returns = {
      return1d: pctReturn(baseline.close, measured.price1d),
      return5d: pctReturn(baseline.close, measured.price5d),
      return20d: pctReturn(baseline.close, measured.price20d),
    };

    // Neutral signals make no directional claim, so scoring one as right or
    // wrong would be inventing a prediction the tool never made. They stay
    // null and /stats excludes them from the hit rate.
    const directionCorrect5d =
      returns.return5d === null || row.direction === "neutral"
        ? null
        : row.direction === "bullish"
          ? returns.return5d > 0
          : returns.return5d < 0;

    const num = (v: number | null, scale: number) =>
      v === null ? null : v.toFixed(scale);

    await database
      .insert(signalOutcomes)
      .values({
        signalId: row.signalId,
        priceAtSignal: baseline.close.toFixed(4),
        price1d: num(measured.price1d, 4),
        price5d: num(measured.price5d, 4),
        price20d: num(measured.price20d, 4),
        return1d: num(returns.return1d, 4),
        return5d: num(returns.return5d, 4),
        return20d: num(returns.return20d, 4),
        directionCorrect5d,
      })
      .onConflictDoUpdate({
        target: signalOutcomes.signalId,
        set: {
          priceAtSignal: baseline.close.toFixed(4),
          price1d: num(measured.price1d, 4),
          price5d: num(measured.price5d, 4),
          price20d: num(measured.price20d, 4),
          return1d: num(returns.return1d, 4),
          return5d: num(returns.return5d, 4),
          return20d: num(returns.return20d, 4),
          directionCorrect5d,
          updatedAt: new Date(),
        },
      });

    if (row.priceAtSignal === null || row.priceAtSignal === undefined) {
      baselinesSet++;
    }
    updated++;
    if (
      measured.price1d !== null &&
      measured.price5d !== null &&
      measured.price20d !== null
    ) {
      finalised++;
    }
  }

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      itemsNew: queue.length,
      signalsNew: updated,
      error:
        skippedOpenGap > 0
          ? `${skippedOpenGap} signal(s) left pending on unresolved price gaps`
          : null,
    })
    .where(eq(scanRuns.id, run.id));

  return {
    runId: run.id,
    considered: queue.length,
    baselinesSet,
    updated,
    finalised,
    skippedNoBaseline,
    skippedOpenGap,
    durationMs: Date.now() - startedAt,
  };
}
