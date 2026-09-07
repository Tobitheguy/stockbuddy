import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { priceFetchFailures, prices } from "@/db/schema";
import { fetchJson } from "@/sources/fetch";

/**
 * Prices.
 *
 * DESIGN NOTE — why there is no historical backfill.
 *
 * Finnhub's free tier gives live quotes but not historical candles, and the
 * obvious free alternatives are either key-gated or now sit behind an
 * anti-bot challenge that it would not be legitimate to defeat.
 *
 * It turns out none of that matters, because of what the prices are FOR.
 * Outcome tracking asks "what did this stock do in the 1, 5 and 20 trading
 * days AFTER the signal fired" — every price it needs lies in the future at
 * the moment the signal is created. So a daily close poll builds exactly the
 * dataset required, going forward, from free endpoints.
 *
 * The visible cost is the ticker page's sparkline, which starts empty and
 * fills in over the following weeks. That is stated on the page rather than
 * hidden behind a fake chart.
 */

export type Quote = {
  symbol: string;
  current: number;
  previousClose: number;
  /** The exchange session this quote belongs to, as a UTC calendar date. */
  marketDate: string;
};

type FinnhubQuote = {
  c?: number; // current
  pc?: number; // previous close
  t?: number; // unix seconds
};

/**
 * A US market date for a given instant.
 *
 * Uses America/New_York, not UTC: at 21:00 UTC it is still the same trading
 * day in New York, but UTC midnight has not yet passed. Deriving the market
 * date from UTC would file an after-hours quote under the following day and
 * silently shift every outcome window by one.
 */
export function marketDateFor(when: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const key = process.env.MARKET_DATA_API_KEY;
  if (!key) {
    throw new Error(
      "MARKET_DATA_API_KEY is not set; prices cannot be fetched. " +
        "The signal feed works without it, but outcome tracking and the " +
        "watchlist return-since-added figure do not.",
    );
  }

  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", key);

  const q = await fetchJson<FinnhubQuote>(url.toString());

  // Finnhub answers 200 with zeroes for an unknown or delisted symbol rather
  // than an error, so a zero price has to be treated as a failure here or it
  // would be stored as a real close and corrupt every return computed from it.
  if (!q.c || q.c <= 0) {
    throw new Error(`No usable quote for ${symbol} (price came back as ${q.c})`);
  }

  return {
    symbol,
    current: q.c,
    previousClose: q.pc ?? q.c,
    marketDate: marketDateFor(q.t ? new Date(q.t * 1000) : new Date()),
  };
}

/** Store one daily close. Idempotent — re-running a day is harmless. */
export async function storeClose(
  symbol: string,
  marketDate: string,
  close: number,
): Promise<void> {
  await db()
    .insert(prices)
    .values({ symbol, marketDate, close: close.toFixed(4) })
    .onConflictDoUpdate({
      target: [prices.symbol, prices.marketDate],
      set: { close: close.toFixed(4) },
    });
}

/**
 * Record that a price could not be fetched.
 *
 * This is what stops a fetch failure from being indistinguishable from a
 * market holiday. Without it, a missing row silently shifts the "+5 trading
 * days" offset and reports a wrong return with no way to detect it.
 */
export async function recordPriceGap(
  symbol: string,
  marketDate: string,
  reason: string,
): Promise<void> {
  await db()
    .insert(priceFetchFailures)
    .values({ symbol, marketDate, reason: reason.slice(0, 300) })
    .onConflictDoNothing({
      target: [priceFetchFailures.symbol, priceFetchFailures.marketDate],
    });
}

/** True if any unresolved gap exists for this symbol on or after a date. */
export async function hasOpenGap(
  symbol: string,
  since: string,
): Promise<boolean> {
  const rows = await db()
    .select({ id: priceFetchFailures.id })
    .from(priceFetchFailures)
    .where(
      and(
        eq(priceFetchFailures.symbol, symbol),
        gte(priceFetchFailures.marketDate, since),
        sql`${priceFetchFailures.resolvedAt} is null`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Closes for a symbol, oldest first. Only trading days have rows. */
export async function closesFor(
  symbol: string,
  limit = 90,
): Promise<Array<{ marketDate: string; close: number }>> {
  const rows = await db()
    .select({ marketDate: prices.marketDate, close: prices.close })
    .from(prices)
    .where(eq(prices.symbol, symbol))
    .orderBy(desc(prices.marketDate))
    .limit(limit);

  return rows
    .map((r) => ({ marketDate: r.marketDate, close: Number(r.close) }))
    .reverse();
}

/**
 * The close N trading days after a given date.
 *
 * "N trading days" is "the Nth following row", which works precisely because
 * only trading days ever get a row — see the note on the prices table. The
 * caller must check hasOpenGap first, or a failed fetch would masquerade as a
 * market holiday and shift the answer.
 */
export async function closeNTradingDaysAfter(
  symbol: string,
  fromDate: string,
  n: number,
): Promise<{ marketDate: string; close: number } | null> {
  const rows = await db()
    .select({ marketDate: prices.marketDate, close: prices.close })
    .from(prices)
    .where(and(eq(prices.symbol, symbol), sql`${prices.marketDate} > ${fromDate}`))
    .orderBy(asc(prices.marketDate))
    .limit(n);

  if (rows.length < n) return null; // not enough trading days have elapsed yet
  const row = rows[n - 1];
  return { marketDate: row.marketDate, close: Number(row.close) };
}

/** Percentage return, or null when either side is missing. */
export function pctReturn(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}
