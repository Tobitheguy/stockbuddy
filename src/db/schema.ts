import {
  date,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Signal Desk schema.
 *
 * Conventions:
 * - Every timestamp is `timestamptz` and stored UTC. Display converts to
 *   America/Los_Angeles at the edge (src/lib/format.ts). Nothing in the
 *   database knows about the display timezone.
 * - Money and prices are `numeric`, never float. A float price is a rounding
 *   bug waiting to appear in a return calculation.
 * - `numeric` comes back from the driver as a string. Read helpers convert;
 *   see the note on `num()` at the bottom of this file.
 */

// ---------------------------------------------------------------------------
// Enums. The TypeScript vocabulary lives in src/lib/types.ts; these mirror it.
// Keeping them as real Postgres enums means a bad value is rejected by the
// database, not just by the Zod layer that happened to run first.
// ---------------------------------------------------------------------------

export const sourceKind = pgEnum("source_kind", ["rss", "api", "edgar"]);

export const eventType = pgEnum("event_type", [
  "earnings",
  "guidance",
  "M&A",
  "contract_win",
  "product_launch",
  "regulatory_policy",
  "macro",
  "legal",
  "management_change",
  "capital_raise",
  "insider_trade",
  "other",
]);

export const direction = pgEnum("direction", ["bullish", "bearish", "neutral"]);

export const horizon = pgEnum("horizon", ["days", "weeks", "months"]);

export const runKind = pgEnum("run_kind", [
  "scan",
  "process",
  "outcomes",
  "probe",
  "tickers",
]);

export const llmStage = pgEnum("llm_stage", ["triage", "score"]);

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: sourceKind("kind").notNull(),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  pollIntervalSec: integer("poll_interval_sec").notNull().default(300),
  /** 0-1 multiplier on score. See src/config/source-seed.ts for the rationale. */
  qualityWeight: numeric("quality_weight", { precision: 3, scale: 2 })
    .notNull()
    .default("0.50"),
  /**
   * Whether the ingester may persist full body text for this source. Enforced
   * on every scan, which is why it is a column and not a build-time constant:
   * the content rule is a runtime obligation, not documentation.
   */
  storeBody: boolean("store_body").notNull().default(false),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Consecutive failures. Reset to 0 on success; used to back off a sick feed. */
    errorStreak: integer("error_streak").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("sources_quality_weight_range", sql`${t.qualityWeight} between 0 and 1`),
    // A zero or negative interval would make the scanner hammer the source on
    // every invocation, which is how you get banned from a free feed.
    check("sources_poll_interval_positive", sql`${t.pollIntervalSec} >= 30`),
  ],
);

// ---------------------------------------------------------------------------
// items — one ingested document, before any model has looked at it.
// ---------------------------------------------------------------------------

export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),

    canonicalUrl: text("canonical_url").notNull(),
    /** sha256 of the normalized URL. The cheap exact-duplicate check. */
    urlHash: text("url_hash").notNull(),

    title: text("title").notNull(),
    summary: text("summary"),
    /** Only populated when the source's store_body is true. Capped at ingest. */
    bodyText: text("body_text"),

    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** sha256 of title+summary. Catches the same item republished at a new URL. */
    contentHash: text("content_hash").notNull(),
    /**
     * Fingerprint of the normalized headline, used to cluster the SAME STORY
     * across different sources. When six outlets carry one contract award we
     * want to pay a model to read it once, not six times. This is the single
     * biggest cost lever in the system — see docs/source-strategy.md.
     */
    storyKey: text("story_key"),
    /**
     * Set when a free rule-based filter dropped this item before any model
     * call: routine 10b5-1 vesting, non-English, not US-listed, duplicate
     * story. Recorded rather than discarded so /stats can show what was
     * filtered and prove the filter is not eating real signals.
     */
    prefilterReason: text("prefilter_reason"),

    processedAt: timestamp("processed_at", { withTimezone: true }),
    processError: text("process_error"),
  },
  (t) => [
    // Exact-duplicate guard. Running the scanner twice must not insert twice.
    uniqueIndex("items_canonical_url_key").on(t.canonicalUrl),
    index("items_url_hash_idx").on(t.urlHash),
    index("items_content_hash_idx").on(t.contentHash),
    index("items_story_key_idx").on(t.storyKey),
    index("items_published_at_idx").on(t.publishedAt.desc()),
    index("items_source_id_idx").on(t.sourceId),
    // The processor's work queue: unprocessed, not prefiltered, oldest first.
    // Partial so the index stays small as processed rows accumulate.
    index("items_unprocessed_idx")
      .on(t.publishedAt)
      .where(sql`${t.processedAt} is null and ${t.prefilterReason} is null`),
  ],
);

// ---------------------------------------------------------------------------
// tickers — the US-listed universe, refreshed weekly from the market-data API.
// ---------------------------------------------------------------------------

export const tickers = pgTable(
  "tickers",
  {
    symbol: text("symbol").primaryKey(),
    name: text("name").notNull(),
    exchange: text("exchange"),
    sector: text("sector"),
    industry: text("industry"),
    marketCap: numeric("market_cap", { precision: 20, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tickers_is_active_idx").on(t.isActive),
    // Symbols are stored uppercase so /t/aapl and /t/AAPL cannot become two
    // different rows.
    check("tickers_symbol_upper", sql`${t.symbol} = upper(${t.symbol})`),
  ],
);

// ---------------------------------------------------------------------------
// signals — one model judgement about one item, for one symbol or one sector.
// ---------------------------------------------------------------------------

export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),

    /**
     * Null means this is a sector-level signal — a tariff or a rule that moves
     * an industry without naming a company. Those are the second-order reads
     * this tool exists for, so they are first-class rows, not a special case.
     */
    /**
     * ON DELETE RESTRICT, deliberately.
     *
     * This was `set null`, and the comment claimed a deleted ticker would turn
     * its signals into sector-level ones. That was simply false: the
     * signals_symbol_or_sector CHECK rejects a row with neither, so the DELETE
     * failed with a confusing constraint violation every time. RESTRICT fails
     * at the foreign key instead, which says what is actually happening.
     *
     * Tickers should be retired by setting `is_active = false`, never deleted.
     * A delisted company's signals are exactly the history /stats needs.
     */
    symbol: text("symbol").references(() => tickers.symbol, {
      onDelete: "restrict",
    }),
    sector: text("sector"),

    eventType: eventType("event_type").notNull(),
    direction: direction("direction").notNull(),
    /** 1-5. Constrained in the database, not only in Zod. */
    magnitude: integer("magnitude").notNull(),
    /** 0-1. */
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    horizon: horizon("horizon").notNull(),

    /** magnitude x confidence x source weight x recency decay, 0-100. */
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),

    rationale: text("rationale").notNull(),
    keyFacts: jsonb("key_facts"),

    model: text("model").notNull(),
    /** So /stats can compare prompt versions against each other. */
    promptVersion: text("prompt_version").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Re-processing an item must not create a second copy of the same signal.
     * NULLS NOT DISTINCT matters here: without it Postgres treats every null
     * symbol as unique, and every sector-level signal would duplicate on every
     * reprocess — exactly the rows we care most about.
     */
    unique("signals_item_symbol_sector_key")
      .on(t.itemId, t.symbol, t.sector)
      .nullsNotDistinct(),
    index("signals_score_idx").on(t.score.desc()),
    index("signals_symbol_idx").on(t.symbol),
    index("signals_created_at_idx").on(t.createdAt.desc()),
    index("signals_event_type_idx").on(t.eventType),

    /**
     * Range guards enforced by Postgres, not only by Zod.
     *
     * Zod validates what the model returned this run. These validate every
     * write forever, including a future bug in the scoring code, a manual
     * UPDATE, or a backfill script. A confidence of 4.7 or a magnitude of 0
     * would silently poison every hit-rate number on /stats, and that is the
     * one page whose credibility the whole tool rests on.
     */
    check("signals_magnitude_range", sql`${t.magnitude} between 1 and 5`),
    check("signals_confidence_range", sql`${t.confidence} between 0 and 1`),
    check("signals_score_range", sql`${t.score} between 0 and 100`),
    // A sector-level signal has no symbol; a company signal has no sector.
    // One or the other must be present, or the row points at nothing.
    check(
      "signals_symbol_or_sector",
      sql`${t.symbol} is not null or ${t.sector} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// signal_outcomes — the scorecard on the tool itself.
// ---------------------------------------------------------------------------

export const signalOutcomes = pgTable(
  "signal_outcomes",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signal_id")
      .notNull()
      .unique()
      .references(() => signals.id, { onDelete: "cascade" }),

    priceAtSignal: numeric("price_at_signal", { precision: 14, scale: 4 }),
    price1d: numeric("price_1d", { precision: 14, scale: 4 }),
    price5d: numeric("price_5d", { precision: 14, scale: 4 }),
    price20d: numeric("price_20d", { precision: 14, scale: 4 }),

    return1d: numeric("return_1d", { precision: 8, scale: 4 }),
    return5d: numeric("return_5d", { precision: 8, scale: 4 }),
    return20d: numeric("return_20d", { precision: 8, scale: 4 }),

    /**
     * Null until the +5 close exists. Null is "not yet known", NOT "wrong" —
     * the /stats queries must filter on `is not null` or the hit rate is
     * silently diluted by every pending signal.
     */
    directionCorrect5d: boolean("direction_correct_5d"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Partial index on the actual work queue: outcomes still missing a price.
     *
     * The previous version indexed `updated_at` alone, which Postgres could
     * not use for "find rows where price_5d is null" — EXPLAIN showed a Seq
     * Scan regardless of table size. Same mistake the items queue avoided;
     * mirrored here.
     */
    index("signal_outcomes_pending_idx")
      .on(t.updatedAt)
      .where(
        sql`${t.price1d} is null or ${t.price5d} is null or ${t.price20d} is null`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// prices — daily closes.
//
// Only trading days ever get a row. That is deliberate: "+5 trading days"
// becomes "the 5th following row for this symbol", so the outcomes job needs
// no market-holiday calendar and cannot drift when the NYSE closes for a
// funeral or a hurricane.
// ---------------------------------------------------------------------------

export const prices = pgTable(
  "prices",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => tickers.symbol, { onDelete: "cascade" }),
    /**
     * A calendar DATE, not a timestamp.
     *
     * This was a timestamptz and it was a real bug: two rows for the same day
     * at 00:00:00.000Z and 00:00:00.001Z both satisfied the primary key,
     * inventing a phantom trading day and permanently desyncing the +1/+5/+20
     * offset arithmetic for that symbol. A `date` column makes the duplicate
     * impossible at the type level instead of relying on every writer to
     * truncate correctly.
     */
    marketDate: date("market_date").notNull(),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.marketDate] }),
    index("prices_symbol_date_idx").on(t.symbol, t.marketDate.desc()),
  ],
);

/**
 * price_fetch_failures — the gap detector.
 *
 * The "+5 trading days = the 5th following row" trick only holds if a missing
 * row always means "the market was closed". If the price API simply failed for
 * a day, the resulting `prices` table is bit-for-bit identical to a genuine
 * holiday, and the outcomes job would silently measure the wrong date and
 * report a wrong hit rate on /stats — with no way to tell.
 *
 * So every failed fetch is recorded. The outcomes job refuses to finalise an
 * outcome whose window overlaps a recorded failure, and marks it for retry
 * instead. An unmeasurable outcome is fine; a silently wrong one is not.
 */
export const priceFetchFailures = pgTable(
  "price_fetch_failures",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    marketDate: date("market_date").notNull(),
    reason: text("reason").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("price_fetch_failures_symbol_date_key").on(t.symbol, t.marketDate),
    // The outcomes job asks "are there unresolved gaps for this symbol in this
    // window?" on every finalisation, so the open ones must be cheap to find.
    index("price_fetch_failures_open_idx")
      .on(t.symbol, t.marketDate)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// watchlist
// ---------------------------------------------------------------------------

export const watchlist = pgTable("watchlist", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => tickers.symbol, { onDelete: "cascade" }),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),

  /**
   * Price captured when the symbol was added, so the watchlist can show the
   * return since *your* decision — not since the signal fired.
   *
   * This is the most direct answer to "is this thing actually reliable".
   * It is nullable because the market can be closed when you add a symbol, or
   * the price fetch can fail; `priceAtAddAt` records when the price was
   * actually taken so a stale capture is visible rather than silently wrong.
   */
  priceAtAdd: numeric("price_at_add", { precision: 14, scale: 4 }),
  priceAtAddAt: timestamp("price_at_add_at", { withTimezone: true }),
  priceAtAddSource: text("price_at_add_source"),
});

// ---------------------------------------------------------------------------
// scan_runs — one row per cron invocation, for the /sources health view.
// ---------------------------------------------------------------------------

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: serial("id").primaryKey(),
    kind: runKind("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    sourcesOk: integer("sources_ok").notNull().default(0),
    sourcesFailed: integer("sources_failed").notNull().default(0),
    itemsNew: integer("items_new").notNull().default(0),
    /** Dropped by rules before any model call. Proves the filter is working. */
    itemsPrefiltered: integer("items_prefiltered").notNull().default(0),
    signalsNew: integer("signals_new").notNull().default(0),
    llmCostUsd: numeric("llm_cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    error: text("error"),
  },
  (t) => [index("scan_runs_started_at_idx").on(t.startedAt.desc())],
);

// ---------------------------------------------------------------------------
// llm_usage — every model call, for the daily budget guard and /stats.
// ---------------------------------------------------------------------------

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").references(() => scanRuns.id, {
      onDelete: "set null",
    }),
    stage: llmStage("stage").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Cached reads bill at ~10% of input; tracked separately or cost is wrong. */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The budget guard sums today's spend on every processing batch, so this
    // index is on the hot path.
    index("llm_usage_created_at_idx").on(t.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Ticker = typeof tickers.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type SignalOutcome = typeof signalOutcomes.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;
export type ScanRun = typeof scanRuns.$inferSelect;
export type LlmUsage = typeof llmUsage.$inferSelect;

/**
 * node-postgres returns `numeric` as a string to avoid float precision loss.
 * That is correct, and it means every read of a price, score or cost must be
 * converted deliberately rather than by accident — `"12.5" * 2` is 25 but
 * `"12.5" + 2` is "12.52".
 */
export function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
