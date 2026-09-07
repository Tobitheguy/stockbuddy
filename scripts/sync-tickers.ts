import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { tickers } from "../src/db/schema";
import { fetchJson } from "../src/sources/fetch";

/**
 * Sync the US-listed ticker universe: `npm run sync:tickers`
 *
 * Source is the SEC's own company_tickers.json — free, no API key, ~10,400
 * companies, and it carries the CIK.
 *
 * The CIK is the reason this is preferred over the market-data API's listing
 * endpoint. EDGAR filings identify a company by CIK and never by symbol, so
 * without it a filing can only be matched to a ticker by fuzzy name
 * comparison. With it the join is exact.
 *
 * Run weekly. Companies list, delist and rename constantly.
 */

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

type SecRow = { cik_str: number; ticker: string; title: string };

async function main() {
  const raw = await fetchJson<Record<string, SecRow>>(SEC_TICKERS_URL, {
    sec: true,
  });

  const rows = Object.values(raw).filter(
    (r) => r?.ticker && r?.title && r.cik_str != null,
  );
  console.log(`fetched ${rows.length} companies from sec.gov`);

  // Symbols are stored uppercase — there is a CHECK constraint enforcing it.
  // SEC uses "-" where exchanges use "." for share classes (BRK-B vs BRK.B);
  // keep the SEC form, since that is what the EDGAR feeds use.
  const values = rows.map((r) => ({
    symbol: r.ticker.toUpperCase().trim(),
    name: r.title.trim(),
    cik: String(r.cik_str).padStart(10, "0"),
    isActive: true,
  }));

  // Deduplicate: a few CIKs map to more than one class of share.
  const bySymbol = new Map(values.map((v) => [v.symbol, v]));
  const unique = [...bySymbol.values()].filter((v) => v.symbol.length <= 10);

  const database = db();
  const CHUNK = 500;
  let written = 0;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    await database
      .insert(tickers)
      .values(chunk)
      .onConflictDoUpdate({
        target: tickers.symbol,
        set: {
          name: sql`excluded.name`,
          cik: sql`excluded.cik`,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    written += chunk.length;
    process.stdout.write(`\r  upserted ${written}/${unique.length}`);
  }
  console.log("");

  const [{ count }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tickers);
  console.log(`tickers table now holds ${count} symbols`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-tickers failed:", err);
    process.exit(1);
  });
