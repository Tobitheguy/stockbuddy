import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { scanRuns, signals, watchlist } from "@/db/schema";
import {
  fetchQuote,
  marketDateFor,
  recordPriceGap,
  storeClose,
} from "./prices";

/**
 * Daily close refresh.
 *
 * Records one close per symbol per trading day for every symbol we need to
 * measure: everything on the watchlist, plus everything with a signal recent
 * enough that its +20 trading day window is still open.
 *
 * Every failure is recorded as a gap. That is the whole reason this is not a
 * fire-and-forget loop: without the gap record, a symbol we simply failed to
 * fetch looks identical to a market holiday, and the "+5 trading days" offset
 * silently measures the wrong date.
 */

/** A 20-trading-day window is about 30 calendar days; 40 gives margin. */
const SIGNAL_WINDOW_DAYS = 40;

/**
 * Free tier is 60 requests/minute. 1.1s spacing keeps us comfortably under it
 * even with retries, and this job is not latency-sensitive.
 */
const SPACING_MS = 1100;

export type RefreshSummary = {
  runId: number;
  marketDate: string;
  symbols: number;
  stored: number;
  gaps: number;
  durationMs: number;
  failures: Array<{ symbol: string; reason: string }>;
};

async function symbolsToTrack(): Promise<string[]> {
  const database = db();
  const since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000);

  const watched = await database
    .select({ symbol: watchlist.symbol })
    .from(watchlist);

  const recent = await database
    .selectDistinct({ symbol: signals.symbol })
    .from(signals)
    .where(gte(signals.createdAt, since))
    .orderBy(desc(signals.symbol));

  const all = new Set<string>();
  for (const r of watched) all.add(r.symbol);
  for (const r of recent) if (r.symbol) all.add(r.symbol);
  return [...all];
}

export async function refreshPrices(
  opts: { limit?: number } = {},
): Promise<RefreshSummary> {
  const database = db();
  const startedAt = Date.now();
  const marketDate = marketDateFor(new Date());

  const [run] = await database
    .insert(scanRuns)
    .values({ kind: "outcomes" })
    .returning({ id: scanRuns.id });

  let symbols = await symbolsToTrack();
  if (opts.limit) symbols = symbols.slice(0, opts.limit);

  let stored = 0;
  let gaps = 0;
  const failures: Array<{ symbol: string; reason: string }> = [];

  for (const symbol of symbols) {
    try {
      const quote = await fetchQuote(symbol);
      // Trust the quote's own session date over today's: an after-hours poll
      // still belongs to the session that just closed.
      await storeClose(symbol, quote.marketDate, quote.current);
      stored++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await recordPriceGap(symbol, marketDate, reason);
      failures.push({ symbol, reason: reason.slice(0, 120) });
      gaps++;
    }
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      sourcesOk: stored,
      sourcesFailed: gaps,
      error: gaps > 0 ? `${gaps} price gap(s) recorded` : null,
    })
    .where(sql`${scanRuns.id} = ${run.id}`);

  return {
    runId: run.id,
    marketDate,
    symbols: symbols.length,
    stored,
    gaps,
    durationMs: Date.now() - startedAt,
    failures,
  };
}
