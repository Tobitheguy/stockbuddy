"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickers, watchlist } from "@/db/schema";
import { fetchQuote, marketDateFor, storeClose } from "@/market/prices";

/**
 * Watchlist mutations.
 *
 * Adding a symbol captures the price at that moment, so the watchlist can
 * later show the return since YOUR decision — not since a signal fired. That
 * is the most direct measure of whether this tool is worth trusting, which is
 * why the capture happens here at add time and cannot be reconstructed later.
 */

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };

export async function addToWatchlist(
  symbolRaw: string,
  note?: string,
): Promise<ActionResult> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!/^[A-Z][A-Z.\-]{0,9}$/.test(symbol)) {
    return { ok: false, error: `"${symbolRaw}" is not a valid ticker symbol.` };
  }

  const database = db();

  const known = await database
    .select({ symbol: tickers.symbol })
    .from(tickers)
    .where(eq(tickers.symbol, symbol))
    .limit(1);
  if (known.length === 0) {
    return {
      ok: false,
      error: `${symbol} is not in the US-listed universe. Run npm run sync:tickers if it is newly listed.`,
    };
  }

  // Capture the entry price. Deliberately NOT fatal if it fails: being unable
  // to reach the price API is a poor reason to refuse to track a company. The
  // row is written with a null entry price, which the watchlist shows honestly
  // as "not captured" rather than as a zero return.
  let priceAtAdd: string | null = null;
  let priceAtAddAt: Date | null = null;
  let priceNote: string | undefined;

  try {
    const quote = await fetchQuote(symbol);
    priceAtAdd = quote.current.toFixed(4);
    priceAtAddAt = new Date();
    // The same number is a data point in its own right.
    await storeClose(symbol, quote.marketDate, quote.current);
  } catch (err) {
    priceNote =
      "Added, but the entry price could not be captured: " +
      (err instanceof Error ? err.message.slice(0, 120) : "unknown error");
  }

  await database
    .insert(watchlist)
    .values({
      symbol,
      note: note?.trim() || null,
      priceAtAdd,
      priceAtAddAt,
      priceAtAddSource: priceAtAdd ? "finnhub_quote" : null,
    })
    // Re-adding must not silently reset the entry price — that would erase the
    // record of when you actually decided to watch it.
    .onConflictDoNothing({ target: watchlist.symbol });

  revalidatePath("/watchlist");
  revalidatePath(`/t/${symbol}`);
  revalidatePath("/");
  return { ok: true, note: priceNote };
}

export async function removeFromWatchlist(
  symbolRaw: string,
): Promise<ActionResult> {
  const symbol = symbolRaw.trim().toUpperCase();
  await db().delete(watchlist).where(eq(watchlist.symbol, symbol));
  revalidatePath("/watchlist");
  revalidatePath(`/t/${symbol}`);
  revalidatePath("/");
  return { ok: true };
}

/** Refresh today's close for every watchlist symbol. */
export async function refreshWatchlistPrices(): Promise<ActionResult> {
  const rows = await db().select({ symbol: watchlist.symbol }).from(watchlist);
  let ok = 0;
  const failed: string[] = [];

  for (const r of rows) {
    try {
      const q = await fetchQuote(r.symbol);
      await storeClose(r.symbol, q.marketDate, q.current);
      ok++;
    } catch {
      failed.push(r.symbol);
    }
  }

  revalidatePath("/watchlist");
  return failed.length
    ? { ok: true, note: `${ok} updated, ${failed.length} failed: ${failed.join(", ")}` }
    : { ok: true, note: `${ok} price${ok === 1 ? "" : "s"} updated` };
}

/** Today's market date, for the UI. */
export async function todayMarketDate(): Promise<string> {
  return marketDateFor(new Date());
}
