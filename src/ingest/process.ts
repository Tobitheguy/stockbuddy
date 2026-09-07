import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, scanRuns, signals, sources, tickers } from "@/db/schema";
import { computeScore, RULE_BASED_CONFIDENCE, rulePrior } from "@/scoring";
import {
  buildNameIndex,
  matchTickers,
  type TickerMatch,
} from "./ticker-match";

/**
 * Turn ingested items into signals.
 *
 * Two modes today:
 *
 *   off   Rule-based only. Free. Matches tickers, applies a per-source prior
 *         for magnitude and event type, and scores by source weight and
 *         recency. Direction is always neutral, because nothing has read the
 *         content — see the note in scoring.ts.
 *
 *   llm   Not yet implemented. Stage A triage + Stage B scoring.
 *
 * Items that match no listed company are still marked processed, so the queue
 * drains. They simply produce no signal.
 */

export const RULE_MODEL = "rules";
export const RULE_PROMPT_VERSION = "rules-v1";

export type ScoringMode = "off" | "watchlist" | "haiku" | "full";

export function scoringMode(): ScoringMode {
  const raw = (process.env.SCORING_MODE ?? "off").toLowerCase();
  if (raw === "watchlist" || raw === "haiku" || raw === "full") return raw;
  return "off";
}

export type ProcessSummary = {
  runId: number;
  mode: ScoringMode;
  itemsConsidered: number;
  itemsWithTickers: number;
  signalsCreated: number;
  durationMs: number;
  llmCostUsd: number;
};

/** How many items one invocation will handle. Keeps the function inside its budget. */
const BATCH_SIZE = 400;

export async function runProcess(
  opts: { limit?: number } = {},
): Promise<ProcessSummary> {
  const database = db();
  const mode = scoringMode();
  const startedAt = Date.now();

  const [run] = await database
    .insert(scanRuns)
    .values({ kind: "process" })
    .returning({ id: scanRuns.id });

  // The ticker universe. Loaded once per run rather than per item.
  const universe = await database
    .select({ symbol: tickers.symbol, name: tickers.name, cik: tickers.cik })
    .from(tickers)
    .where(eq(tickers.isActive, true));
  const known = new Set(universe.map((t) => t.symbol));
  const nameIndex = buildNameIndex(universe);
  // CIK -> symbol. The exact join for EDGAR filings, which carry a CIK and
  // never a ticker.
  const cikIndex = new Map<string, string>();
  for (const t of universe) if (t.cik) cikIndex.set(t.cik, t.symbol);

  // The work queue, oldest first so a backlog drains in publication order.
  const queue = await database
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      publishedAt: items.publishedAt,
      sourceName: sources.name,
      qualityWeight: sources.qualityWeight,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(isNull(items.processedAt), isNull(items.prefilterReason)))
    .orderBy(asc(items.publishedAt))
    .limit(opts.limit ?? BATCH_SIZE);

  const now = new Date();
  let itemsWithTickers = 0;
  let signalsCreated = 0;

  for (const item of queue) {
    const haystack = `${item.title}\n${item.summary ?? ""}`;
    const matches = matchTickers(haystack, known, nameIndex, cikIndex);

    if (matches.length > 0) {
      itemsWithTickers++;
      const created =
        mode === "off"
          ? await writeRuleSignals(item, matches, now)
          : await writeRuleSignals(item, matches, now); // LLM path lands next
      signalsCreated += created;
    }

    await database
      .update(items)
      .set({ processedAt: new Date() })
      .where(eq(items.id, item.id));
  }

  const durationMs = Date.now() - startedAt;

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      itemsNew: queue.length,
      signalsNew: signalsCreated,
    })
    .where(eq(scanRuns.id, run.id));

  return {
    runId: run.id,
    mode,
    itemsConsidered: queue.length,
    itemsWithTickers,
    signalsCreated,
    durationMs,
    llmCostUsd: 0,
  };
}

type QueueItem = {
  id: number;
  title: string;
  summary: string | null;
  publishedAt: Date;
  sourceName: string;
  qualityWeight: string;
};

/**
 * Rule-based signals. No model involved, and the row says so: `model` is
 * "rules", so /stats can separate rule-scored rows from model-scored ones and
 * never present them as the same kind of claim.
 */
async function writeRuleSignals(
  item: QueueItem,
  matches: TickerMatch[],
  now: Date,
): Promise<number> {
  const prior = rulePrior(item.sourceName);
  const sourceWeight = Number(item.qualityWeight);

  // Only the best-evidence ticker. A press release naming five companies is
  // usually about one of them; emitting five signals would be five guesses.
  const best = matches[0];

  const confidence = Math.min(
    RULE_BASED_CONFIDENCE,
    // A weak name match should not inherit the full rule-based confidence.
    RULE_BASED_CONFIDENCE * best.confidence,
  );

  const score = computeScore({
    magnitude: prior.magnitude,
    confidence,
    sourceWeight,
    publishedAt: item.publishedAt,
    now,
  });

  const inserted = await db()
    .insert(signals)
    .values({
      itemId: item.id,
      symbol: best.symbol,
      sector: null,
      eventType: prior.eventType,
      direction: prior.direction,
      magnitude: prior.magnitude,
      confidence: confidence.toFixed(2),
      horizon: "days",
      score: score.toFixed(2),
      rationale:
        `Rule-based match, no model reading. Ticker identified via ` +
        `${best.via.replace(/_/g, " ")}. Magnitude is a prior for this source ` +
        `type, not a judgement about the content, and direction is deliberately ` +
        `neutral because nothing has read the item. Set SCORING_MODE to enable ` +
        `Claude scoring for direction and reasoning.`,
      keyFacts: { matchedVia: best.via, matchConfidence: best.confidence },
      model: RULE_MODEL,
      promptVersion: RULE_PROMPT_VERSION,
    })
    // Re-processing must not duplicate. Matches the NULLS NOT DISTINCT
    // constraint verified against the live database at CP2.
    .onConflictDoNothing({
      target: [signals.itemId, signals.symbol, signals.sector],
    })
    .returning({ id: signals.id });

  return inserted.length;
}

/** Today's recorded LLM spend, for the budget guard. */
export async function todaysLlmSpendUsd(): Promise<number> {
  // The neon-http driver returns a result object rather than a plain array,
  // so the rows come from `.rows` and not from destructuring the result.
  const result = await db().execute<{ total: string }>(
    sql`select coalesce(sum(cost_usd), 0)::text as total
        from llm_usage
        where created_at >= date_trunc('day', now() at time zone 'utc')`,
  );
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return Number(rows[0]?.total ?? 0);
}
