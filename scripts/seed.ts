import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { db } from "../src/db/client";
import { sources, tickers } from "../src/db/schema";
import { SEED_SOURCES } from "../src/config/source-seed";

/**
 * Idempotent seed. Safe to run repeatedly — it upserts rather than inserts, so
 * re-running after editing src/config/source-seed.ts syncs the changes without
 * duplicating rows or clobbering runtime health state.
 *
 * Deliberately preserved on re-seed: `last_fetched_at`, `last_error` and
 * `error_streak`. Those belong to the scanner, not to the config file, and
 * wiping them would make /sources lie about feed health after every deploy.
 *
 * `enabled` IS overwritten from the config. That is the intended direction:
 * the config file is the source of truth for what should be on. If you toggle
 * a source from the UI and then re-seed, the config wins — so change the
 * config, not just the toggle, when you mean it permanently.
 */

/**
 * A small starter universe so the app is navigable before a market-data key
 * exists. The weekly ticker sync (Step 3) replaces this with the full
 * US-listed universe from the API; these rows just make the foreign keys on
 * `signals` and `watchlist` satisfiable in the meantime.
 *
 * Chosen to cover the sectors the fixtures exercise: defence, steel, utilities,
 * semis, pharma, autos, homebuilding.
 */
const STARTER_TICKERS = [
  { symbol: "BWXT", name: "BWX Technologies, Inc.", exchange: "NYSE", sector: "Industrials", industry: "Aerospace & Defense" },
  { symbol: "NUE", name: "Nucor Corporation", exchange: "NYSE", sector: "Basic Materials", industry: "Steel" },
  { symbol: "STLD", name: "Steel Dynamics, Inc.", exchange: "NASDAQ", sector: "Basic Materials", industry: "Steel" },
  { symbol: "CLF", name: "Cleveland-Cliffs Inc.", exchange: "NYSE", sector: "Basic Materials", industry: "Steel" },
  { symbol: "X", name: "United States Steel Corporation", exchange: "NYSE", sector: "Basic Materials", industry: "Steel" },
  { symbol: "AEP", name: "American Electric Power Company, Inc.", exchange: "NASDAQ", sector: "Utilities", industry: "Utilities - Regulated Electric" },
  { symbol: "VRT", name: "Vertiv Holdings Co", exchange: "NYSE", sector: "Industrials", industry: "Electrical Equipment & Parts" },
  { symbol: "ETN", name: "Eaton Corporation plc", exchange: "NYSE", sector: "Industrials", industry: "Electrical Equipment & Parts" },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductors" },
  { symbol: "COP", name: "ConocoPhillips", exchange: "NYSE", sector: "Energy", industry: "Oil & Gas E&P" },
  { symbol: "ROIV", name: "Roivant Sciences Ltd.", exchange: "NASDAQ", sector: "Healthcare", industry: "Biotechnology" },
  { symbol: "PFE", name: "Pfizer Inc.", exchange: "NYSE", sector: "Healthcare", industry: "Drug Manufacturers" },
  { symbol: "VZ", name: "Verizon Communications Inc.", exchange: "NYSE", sector: "Communication Services", industry: "Telecom Services" },
  { symbol: "ZH", name: "Zhihu Inc.", exchange: "NYSE", sector: "Communication Services", industry: "Internet Content" },
  { symbol: "VSAT", name: "Viasat, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Communication Equipment" },
];

async function main() {
  const database = db();

  // --- sources ------------------------------------------------------------
  let inserted = 0;
  for (const s of SEED_SOURCES) {
    const result = await database
      .insert(sources)
      .values({
        name: s.name,
        kind: s.kind,
        url: s.url,
        enabled: s.enabled,
        pollIntervalSec: s.pollIntervalSec,
        qualityWeight: s.qualityWeight.toFixed(2),
        storeBody: s.storeBody,
      })
      .onConflictDoUpdate({
        target: sources.name,
        set: {
          kind: s.kind,
          url: s.url,
          enabled: s.enabled,
          pollIntervalSec: s.pollIntervalSec,
          qualityWeight: s.qualityWeight.toFixed(2),
          storeBody: s.storeBody,
          // last_fetched_at / last_error / error_streak intentionally untouched.
        },
      })
      .returning({ id: sources.id });
    if (result.length > 0) inserted += 1;
  }

  // --- tickers ------------------------------------------------------------
  for (const t of STARTER_TICKERS) {
    await database
      .insert(tickers)
      .values({ ...t, isActive: true })
      .onConflictDoUpdate({
        target: tickers.symbol,
        set: {
          name: t.name,
          exchange: t.exchange,
          sector: t.sector,
          industry: t.industry,
          updatedAt: new Date(),
        },
      });
  }

  const enabled = SEED_SOURCES.filter((s) => s.enabled).length;
  console.log(
    `Seeded ${inserted} sources (${enabled} enabled) and ${STARTER_TICKERS.length} starter tickers.`,
  );
  console.log(
    "\nThe watchlist is intentionally left EMPTY. A seeded watchlist row would\n" +
      "carry no meaningful price_at_add, which would corrupt the return-since-added\n" +
      "figure — the one number that measures whether this tool is worth trusting.\n" +
      "Add symbols yourself and the entry price is captured properly.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
