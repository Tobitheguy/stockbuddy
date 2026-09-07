import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { earningsEvents, watchlist } from "@/db/schema";
import { fetchJson } from "@/sources/fetch";

/**
 * Earnings calendar for watchlist symbols.
 *
 * Watchlist-only on purpose. Earnings dates matter as CONTEXT for stocks the
 * user is actively tracking — "GOOGL reports in 3 days" reframes every signal
 * near that date. Fetching the calendar for all ~400 signal symbols would
 * spend the rate limit annotating rows the user may never open; the watchlist
 * is where attention actually is.
 *
 * Runs inside the daily price cron. Finnhub's free tier serves this endpoint;
 * a failure for one symbol is logged and skipped, never fatal.
 */

type FinnhubEarnings = {
  earningsCalendar?: Array<{
    symbol?: string;
    date?: string;
    hour?: string;
    epsEstimate?: number | null;
  }>;
};

const WINDOW_DAYS = 90;
const SPACING_MS = 1100; // same free-tier budget as the quote poll

export async function syncEarningsCalendar(): Promise<{
  symbols: number;
  stored: number;
}> {
  const key = process.env.MARKET_DATA_API_KEY;
  if (!key) return { symbols: 0, stored: 0 };

  const database = db();
  const rows = await database
    .select({ symbol: watchlist.symbol })
    .from(watchlist);

  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let stored = 0;
  for (const { symbol } of rows) {
    try {
      const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("token", key);

      const data = await fetchJson<FinnhubEarnings>(url.toString(), {
        timeoutMs: 15_000,
      });

      for (const event of data.earningsCalendar ?? []) {
        if (!event.date) continue;
        await database
          .insert(earningsEvents)
          .values({
            symbol,
            reportDate: event.date,
            hour: event.hour || null,
            epsEstimate:
              event.epsEstimate === null || event.epsEstimate === undefined
                ? null
                : event.epsEstimate.toFixed(4),
          })
          // The date can shift as companies reschedule; the fresh fetch wins.
          .onConflictDoUpdate({
            target: [earningsEvents.symbol, earningsEvents.reportDate],
            set: {
              hour: event.hour || null,
              fetchedAt: new Date(),
            },
          });
        stored++;
      }
    } catch (err) {
      console.warn(
        `[earnings] ${symbol}: ${err instanceof Error ? err.message : err}`,
      );
    }
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  return { symbols: rows.length, stored };
}

/** The next report date for a symbol, or null when none is scheduled. */
export async function nextEarnings(
  symbol: string,
): Promise<{ reportDate: string; hour: string | null } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db()
    .select({
      reportDate: earningsEvents.reportDate,
      hour: earningsEvents.hour,
    })
    .from(earningsEvents)
    .where(
      and(eq(earningsEvents.symbol, symbol), gte(earningsEvents.reportDate, today)),
    )
    .orderBy(earningsEvents.reportDate)
    .limit(1);
  return rows[0] ?? null;
}

/** Upcoming reports for every watchlist symbol, for the watchlist page. */
export async function upcomingEarnings(): Promise<
  Map<string, { reportDate: string; hour: string | null }>
> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db().execute(sql`
    select distinct on (symbol) symbol, report_date::text as report_date, hour
    from earnings_events
    where report_date >= ${today}
    order by symbol, report_date`)) as unknown as
    | Array<{ symbol: string; report_date: string; hour: string | null }>
    | { rows: Array<{ symbol: string; report_date: string; hour: string | null }> };

  const list = Array.isArray(rows) ? rows : rows.rows;
  return new Map(
    list.map((r) => [r.symbol, { reportDate: r.report_date, hour: r.hour }]),
  );
}

/** "in 3 days" / "today" — the human phrasing for a report date. */
export function daysUntilLabel(reportDate: string): string {
  const days = Math.round(
    (new Date(reportDate + "T12:00:00Z").getTime() - Date.now()) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
