import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { prices } from "@/db/schema";
import { fetchJson } from "@/sources/fetch";

/**
 * Daily price history, backfilled from Yahoo's public chart endpoint.
 *
 * WHY THIS SOURCE. The tool's own price table only grows forward — one close
 * per day from the quote poll — so a freshly viewed ticker had no chart and,
 * worse, signals had no baseline close to be measured against (493 of the
 * first 500 outcomes were skipped for exactly that reason). Free historical
 * candles are rare: Finnhub moved them behind a paywall, and Stooq now fronts
 * its CSV with a browser-verification challenge that we will not defeat.
 * Yahoo's chart API is a plain unauthenticated GET returning JSON — no
 * challenge, no key, and it is the same endpoint their own quote pages load.
 *
 * The data lands in the same `prices` table the daily poll writes, with
 * ON CONFLICT DO NOTHING — a close the poll already recorded wins over the
 * backfill, so the two writers can never fight over a row.
 */

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

/** Enough for a 5-year chart; ~1250 trading days. */
const FULL_RANGE = "5y";

/** Below this many stored rows, the symbol is treated as never backfilled. */
const BACKFILL_THRESHOLD_ROWS = 250;

export type HistoryResult = {
  fetched: boolean;
  inserted: number;
  reason: string;
};

/**
 * Fetch daily closes for a symbol from Yahoo. Returns [] on any failure —
 * a chart is an enhancement, and the page it feeds must render without it.
 */
export async function fetchDailyHistory(
  symbol: string,
  range: string = FULL_RANGE,
): Promise<Array<{ marketDate: string; close: number }>> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=${range}&interval=1d`;

  let data: YahooChart;
  try {
    data = await fetchJson<YahooChart>(url, { timeoutMs: 15_000 });
  } catch {
    return [];
  }

  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const out: Array<{ marketDate: string; close: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    // Nulls appear on halts and data gaps; a zero close is never real.
    if (close === null || close === undefined || close <= 0) continue;
    // US session timestamps are 13:30/14:30 UTC, so the UTC calendar date is
    // the trading date. This tool is US-listed equities only, per its spec.
    const marketDate = new Date(timestamps[i] * 1000)
      .toISOString()
      .slice(0, 10);
    out.push({ marketDate, close });
  }
  return out;
}

/**
 * Make sure a symbol has chart-worthy history, fetching it if not.
 *
 * Called from the ticker page, so it is deliberately cheap to call twice:
 * a symbol with a filled history and a recent close returns without any
 * network traffic at all. The full 5-year fetch happens once per symbol.
 */
export async function ensureHistory(symbol: string): Promise<HistoryResult> {
  const database = db();

  type Stats = { have: number; newest: string | null };
  const result = (await database.execute(sql`
    select count(*)::int as have, max(market_date)::text as newest
    from prices where symbol = ${symbol}`)) as unknown as
    | Stats[]
    | { rows: Stats[] };
  const stats = Array.isArray(result) ? result[0] : result.rows?.[0];
  const have = stats?.have ?? 0;
  const newest = stats?.newest ?? null;

  const staleDays = newest
    ? (Date.now() - new Date(newest).getTime()) / 86_400_000
    : Infinity;

  let range: string | null = null;
  if (have < BACKFILL_THRESHOLD_ROWS) {
    range = FULL_RANGE; // never backfilled (or a very young listing)
  } else if (staleDays > 4) {
    range = "1mo"; // gap-fill after the daily poll missed some days
  }

  if (!range) return { fetched: false, inserted: 0, reason: "up to date" };

  const history = await fetchDailyHistory(symbol, range);
  if (history.length === 0) {
    return { fetched: true, inserted: 0, reason: "provider returned nothing" };
  }

  // Chunked inserts: five years is ~1250 rows, and one giant VALUES list is
  // where query-size limits live.
  let inserted = 0;
  for (let i = 0; i < history.length; i += 500) {
    const chunk = history.slice(i, i + 500);
    const result = await database
      .insert(prices)
      .values(chunk.map((h) => ({ symbol, marketDate: h.marketDate, close: h.close.toFixed(4) })))
      .onConflictDoNothing()
      .returning({ symbol: prices.symbol });
    inserted += result.length;
  }

  return { fetched: true, inserted, reason: `backfilled ${range}` };
}

/** Closes for the chart, oldest first, capped at ~5y of trading days. */
export async function chartCloses(
  symbol: string,
): Promise<Array<{ marketDate: string; close: number }>> {
  const rows = await db()
    .select({ marketDate: prices.marketDate, close: prices.close })
    .from(prices)
    .where(eq(prices.symbol, symbol))
    .orderBy(desc(prices.marketDate))
    .limit(1300);
  return rows
    .map((r) => ({ marketDate: r.marketDate, close: Number(r.close) }))
    .reverse();
}
