import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { prices, scanRuns, signals, watchlist } from "@/db/schema";
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
  ranOutOfTime: boolean;
  remaining: number;
  failures: Array<{ symbol: string; reason: string }>;
};

/**
 * Symbols to refresh, most-stale first.
 *
 * The order is the point. At one request every 1.1 seconds, several hundred
 * symbols take longer than a serverless invocation is allowed to live, so a
 * run will sometimes be cut short. Sorting by "longest since we last stored a
 * close" makes that safe: whatever a truncated run misses is exactly what the
 * next run starts with, so coverage converges instead of a fixed tail never
 * being fetched at all.
 *
 * The watchlist sorts ahead of everything else unconditionally. Those are the
 * positions the user is actually tracking, and their entry-price comparison is
 * the tool's own scorecard — it must never be the part that gets dropped.
 */
async function symbolsToTrack(): Promise<string[]> {
  const database = db();
  const since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000);

  const watched = await database
    .select({ symbol: watchlist.symbol })
    .from(watchlist);
  const watchedSet = new Set(watched.map((r) => r.symbol));

  const recent = await database
    .selectDistinct({ symbol: signals.symbol })
    .from(signals)
    .where(gte(signals.createdAt, since))
    .orderBy(desc(signals.symbol));

  const candidates = new Set<string>(watchedSet);
  for (const r of recent) if (r.symbol) candidates.add(r.symbol);

  // One query rather than one per symbol: the last stored close per symbol.
  const latest = await database
    .select({
      symbol: prices.symbol,
      last: sql<string>`max(${prices.marketDate})`.as("last"),
    })
    .from(prices)
    .groupBy(prices.symbol);
  const lastSeen = new Map(latest.map((r) => [r.symbol, r.last]));

  return [...candidates].sort((a, b) => {
    const aw = watchedSet.has(a) ? 0 : 1;
    const bw = watchedSet.has(b) ? 0 : 1;
    if (aw !== bw) return aw - bw;
    // "" sorts before any real date, so symbols never fetched come first.
    const cmp = (lastSeen.get(a) ?? "").localeCompare(lastSeen.get(b) ?? "");
    return cmp !== 0 ? cmp : a.localeCompare(b);
  });
}

export async function refreshPrices(
  opts: { limit?: number; deadlineMs?: number } = {},
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
  let done = 0;
  let ranOutOfTime = false;
  const failures: Array<{ symbol: string; reason: string }> = [];

  // Stop before the platform kills the invocation. Being killed mid-loop would
  // leave the run row open forever and, worse, would not record a gap for the
  // symbol in flight — the one state the outcomes job reads as "this date is a
  // market holiday". Finishing early and honestly is always preferable.
  const deadline = opts.deadlineMs ? startedAt + opts.deadlineMs : Infinity;

  for (const symbol of symbols) {
    if (Date.now() + SPACING_MS > deadline) {
      ranOutOfTime = true;
      break;
    }
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
    done++;
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  const remaining = symbols.length - done;
  const notes = [
    gaps > 0 ? `${gaps} price gap(s) recorded` : null,
    ranOutOfTime ? `stopped on time limit, ${remaining} symbol(s) left` : null,
  ].filter(Boolean);

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      sourcesOk: stored,
      sourcesFailed: gaps,
      error: notes.length > 0 ? notes.join("; ") : null,
    })
    .where(sql`${scanRuns.id} = ${run.id}`);

  return {
    runId: run.id,
    marketDate,
    symbols: symbols.length,
    stored,
    gaps,
    durationMs: Date.now() - startedAt,
    ranOutOfTime,
    remaining,
    failures,
  };
}
