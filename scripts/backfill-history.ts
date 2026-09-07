import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { ensureHistory } from "../src/market/history";

/**
 * One-time backfill: five years of daily closes for every symbol that has a
 * signal or a watchlist entry.
 *
 * This is what turns "493 signals skipped, no baseline" into measured
 * outcomes: the baseline close for a signal is the last close on or before its
 * date, and until now that row simply did not exist for anything signalled
 * before the tool started polling. Going forward the daily price job does this
 * incrementally; this script clears the backlog.
 *
 * Free — the history endpoint needs no key. Spaced politely anyway.
 */
const SPACING_MS = 350;

async function main() {
  const result = (await db().execute(sql`
    select distinct symbol from (
      select symbol from watchlist
      union
      select symbol from signals where symbol is not null
    ) s order by symbol`)) as unknown as
    | Array<{ symbol: string }>
    | { rows: Array<{ symbol: string }> };
  const symbols = (Array.isArray(result) ? result : result.rows).map(
    (r) => r.symbol,
  );

  console.log(`${symbols.length} Symbole zu pruefen.\n`);

  let filled = 0;
  let already = 0;
  let empty = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const r = await ensureHistory(symbol).catch(() => null);
    if (!r) {
      empty++;
    } else if (!r.fetched) {
      already++;
    } else if (r.inserted > 0) {
      filled++;
      if (filled % 25 === 0) {
        console.log(`  ${i + 1}/${symbols.length}  (${filled} gefuellt)`);
      }
    } else {
      empty++;
    }
    if (r?.fetched) await new Promise((res) => setTimeout(res, SPACING_MS));
  }

  console.log(
    `\nFertig: ${filled} gefuellt, ${already} hatten schon Historie, ` +
      `${empty} ohne Daten (meist Delistings).`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("backfill-history crashed:", e);
  process.exit(1);
});
