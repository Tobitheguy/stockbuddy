import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  items,
  scanRuns,
  signals,
  sources,
  tickers,
  watchlist,
} from "@/db/schema";
import {
  computeBaseScore,
  computeScore,
  RULE_BASED_CONFIDENCE,
  rulePrior,
} from "@/scoring";
import {
  scoreItem,
  triage,
  isModelUnavailable,
  SCORE_MODEL,
  TRIAGE_MODEL,
  type ScoredSignal,
} from "@/llm/client";
import { SCORE_PROMPT_VERSION } from "@/llm/prompts";
import { alertReasonFor, recordAlert } from "@/alerts/engine";
import { sendAlertEmailIfConfigured } from "@/alerts/email";
import { fetchFilingText } from "@/sources/edgar-document";
import { buildNameIndex, matchTickers, type TickerMatch } from "./ticker-match";

/**
 * Turn ingested items into signals.
 *
 *   off        Rule-based only. Free. Direction always neutral, because
 *              nothing has read the content.
 *   watchlist  Claude reads items touching a watchlist ticker or a
 *              high-priority filing type. Everything else falls back to rules.
 *   haiku      Claude reads everything, cheaply.
 *   full       Haiku triage, Opus scoring. The second-order reasoning.
 *
 * A daily budget cap applies to every mode except off. When it is reached the
 * run stops scoring and says so — it does not silently keep spending, and it
 * does not silently produce nothing.
 */

export const RULE_MODEL = "rules";
export const RULE_PROMPT_VERSION = "rules-v1";

export type ScoringMode = "off" | "watchlist" | "haiku" | "full";

export function scoringMode(): ScoringMode {
  const raw = (process.env.SCORING_MODE ?? "off").toLowerCase();
  if (raw === "watchlist" || raw === "haiku" || raw === "full") return raw;
  return "off";
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.DAILY_LLM_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

/**
 * Filing types worth reading even when the company is not on the watchlist.
 * These are the low-volume, high-consequence ones.
 */
const HIGH_PRIORITY_SOURCE = /8-K|SC 13D|NT 10-|SC TO-T|FDA|FTC|USTR|USASpending|ClinicalTrials/i;

export type ProcessSummary = {
  runId: number;
  mode: ScoringMode;
  itemsConsidered: number;
  itemsWithTickers: number;
  itemsSentToModel: number;
  itemsTriagedOut: number;
  signalsCreated: number;
  secondOrderSignals: number;
  durationMs: number;
  llmCostUsd: number;
  budgetUsd: number;
  haltedOnBudget: boolean;
};

const BATCH_SIZE = 400;

export async function runProcess(
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<ProcessSummary> {
  const database = db();
  const mode = scoringMode();
  const budgetUsd = dailyBudgetUsd();
  const startedAt = Date.now();

  const [run] = await database
    .insert(scanRuns)
    .values({ kind: "process" })
    .returning({ id: scanRuns.id });

  const universe = await database
    .select({ symbol: tickers.symbol, name: tickers.name, cik: tickers.cik })
    .from(tickers)
    .where(eq(tickers.isActive, true));
  const known = new Set(universe.map((t) => t.symbol));
  const nameIndex = buildNameIndex(universe);
  const cikIndex = new Map<string, string>();
  for (const t of universe) if (t.cik) cikIndex.set(t.cik, t.symbol);

  const watchRows = await database
    .select({ symbol: watchlist.symbol, isOwned: watchlist.isOwned })
    .from(watchlist);
  const watched = new Set(watchRows.map((r) => r.symbol));
  const owned = new Set(watchRows.filter((r) => r.isOwned).map((r) => r.symbol));

  const queue = await database
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      body: items.bodyText,
      url: items.canonicalUrl,
      publishedAt: items.publishedAt,
      sourceName: sources.name,
      sourceKind: sources.kind,
      qualityWeight: sources.qualityWeight,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(isNull(items.processedAt), isNull(items.prefilterReason)))
    /**
     * Most valuable first, not oldest first.
     *
     * The daily budget is a hard stop, so the order of this queue decides
     * what the money buys. Oldest-first spent it on whichever stories
     * happened to be published earliest — a filing that could reprice a
     * company waited behind a morning's wire copy and was still waiting when
     * the budget ran out. That is the difference between a budget and a
     * lottery.
     *
     * The order within a tier is still oldest-first, so nothing starves.
     */
    .orderBy(
      sql`case
            /* News about a position the user actually holds. Never queued
               behind anything, at any budget. */
            when exists (
              select 1 from watchlist w
              where w.is_owned
                and (${items.title} ilike '%' || w.symbol || '%'
                     or ${items.summary} ilike '%' || w.symbol || '%')
            ) then 0
            /* Form 4 is checked BEFORE the edgar tier, because it is edgar and
               would otherwise inherit tier 1.

               It is 59% of everything ingested — 5,688 filings in three days
               against 592 8-Ks — and it scores about a fifth as high. Sharing
               the top tier with 8-K, ten times the volume at a fifth of the
               value, meant routine insider paperwork set the agenda for the
               whole feed and ate the budget before the filings that actually
               reprice a company were reached.

               It is not dropped: an unscheduled open-market purchase by an
               executive is one of the few genuinely informative insider
               signals. It simply goes last. Note that prefilter.ts cannot help
               here — ROUTINE_INSIDER_RE is inert on live data, because EDGAR's
               Atom title carries no transaction codes, so every Form 4 reaches
               this queue regardless of how routine it is. Until the filing XML
               is fetched, ordering is the only lever. */
            when ${sources.name} ~* 'form 4' then 4
            /* Primary documents: the filer's own words, legally required,
               and the only tier where magnitude 5 realistically lives. */
            when ${sources.kind} = 'edgar' then 1
            /* Regulators and rule-makers — low volume, high consequence. */
            when ${sources.name} ~ '(FDA|FTC|USTR|Federal Reserve|SEC -)' then 2
            /* Everything else, best sources first. */
            else 3
          end`,
      desc(sources.qualityWeight),
      asc(items.publishedAt),
    )
    .limit(opts.limit ?? BATCH_SIZE);

  const now = new Date();
  let itemsWithTickers = 0;
  let itemsSentToModel = 0;
  let itemsTriagedOut = 0;
  let signalsCreated = 0;
  let secondOrderSignals = 0;
  let haltedOnBudget = false;

  // Read once, then track locally. Re-querying per item would add a database
  // round-trip to every single call for a number that only this loop changes.
  let spentToday = await todaysLlmSpendUsd();

  /**
   * Stop before the platform kills the invocation.
   *
   * Scoring an item takes roughly eight seconds, so a batch of seventy needs
   * ten minutes — far past any serverless limit. Being killed mid-loop leaves
   * the run row open forever and, worse, silently loses the accounting for
   * whatever was already spent. Finishing early is free: `processedAt` is set
   * per item, so the next run picks up exactly where this one stopped.
   */
  const deadline = opts.deadlineMs ? startedAt + opts.deadlineMs : Infinity;
  let ranOutOfTime = false;
  let itemsLeft = 0;
  /** Set once the model becomes unusable; the rest of the run falls back. */
  let modelDownReason: string | null = null;

  for (const [index, item] of queue.entries()) {
    // A model call can take a while; leave enough room to finish the one in
    // flight and still write the run row.
    if (Date.now() > deadline) {
      ranOutOfTime = true;
      itemsLeft = queue.length - index;
      break;
    }

    const haystack = `${item.title}\n${item.summary ?? ""}`;
    const matches = matchTickers(haystack, known, nameIndex, cikIndex);
    if (matches.length > 0) itemsWithTickers++;

    const useModel =
      mode !== "off" &&
      spentToday < budgetUsd &&
      inScope(mode, item.sourceName, matches, watched);

    if (mode !== "off" && spentToday >= budgetUsd) haltedOnBudget = true;

    if (useModel && !modelDownReason) {
      const scoreModel = mode === "full" ? SCORE_MODEL : TRIAGE_MODEL;
      try {
        const { created, secondOrder, cost, triagedOut } = await modelScore(
          item,
          run.id,
          scoreModel,
          known,
          owned,
          now,
        );
        spentToday += cost;
        itemsSentToModel++;
        if (triagedOut) itemsTriagedOut++;
        signalsCreated += created;
        secondOrderSignals += secondOrder;
      } catch (err) {
        /**
         * An exhausted account or a revoked key fails identically on every
         * subsequent item, so the first one settles it: stop calling the
         * model and score the rest by rules. Previously any such error threw
         * out of the whole run, which meant a billing problem stopped
         * ingestion turning into signals at all — the pipeline went dark
         * rather than degraded, and the only symptom was a 500 in a log
         * nobody reads.
         */
        const fatal = isModelUnavailable(err);
        if (!fatal) throw err;
        modelDownReason = fatal;
        console.error(`[process] model unavailable: ${fatal}`);
        if (matches.length > 0) {
          signalsCreated += await writeRuleSignals(item, matches, now);
        }
      }
    } else if (matches.length > 0) {
      signalsCreated += await writeRuleSignals(item, matches, now);
    }

    await database
      .update(items)
      .set({ processedAt: new Date() })
      .where(eq(items.id, item.id));
  }

  // One summary email per run, only when alerts exist and email is
  // configured. Failure is logged inside and never fails the run — alerts
  // stay pending and the next run retries them.
  await sendAlertEmailIfConfigured().catch((err) =>
    console.error("[process] alert email crashed:", err),
  );

  const llmCostUsd = spentToday - (await todaysLlmSpendUsdBefore(startedAt));
  const durationMs = Date.now() - startedAt;

  if (haltedOnBudget) {
    console.warn(
      `[process] daily LLM budget of $${budgetUsd.toFixed(2)} reached. ` +
        `Remaining items were scored by rules instead. Raise ` +
        `DAILY_LLM_BUDGET_USD or wait for the UTC day to roll over.`,
    );
  }

  const notes = [
    modelDownReason,
    haltedOnBudget ? "halted: daily LLM budget reached" : null,
    ranOutOfTime ? `stopped on time limit, ${itemsLeft} item(s) left` : null,
  ].filter(Boolean);

  if (ranOutOfTime) {
    console.warn(
      `[process] time limit reached after ${queue.length - itemsLeft} of ` +
        `${queue.length} items. The remainder stays queued for the next run.`,
    );
  }

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      itemsNew: queue.length - itemsLeft,
      signalsNew: signalsCreated,
      llmCostUsd: Math.max(0, llmCostUsd).toFixed(6),
      error: notes.length > 0 ? notes.join("; ") : null,
    })
    .where(eq(scanRuns.id, run.id));

  return {
    runId: run.id,
    mode,
    itemsConsidered: queue.length - itemsLeft,
    itemsWithTickers,
    itemsSentToModel,
    itemsTriagedOut,
    signalsCreated,
    secondOrderSignals,
    durationMs,
    llmCostUsd: Math.max(0, llmCostUsd),
    budgetUsd,
    haltedOnBudget,
  };
}

/** Which items a given mode is willing to pay a model to read. */
function inScope(
  mode: ScoringMode,
  sourceName: string,
  matches: TickerMatch[],
  watched: ReadonlySet<string>,
): boolean {
  if (mode === "haiku" || mode === "full") return true;
  if (mode === "watchlist") {
    if (matches.some((m) => watched.has(m.symbol))) return true;
    return HIGH_PRIORITY_SOURCE.test(sourceName);
  }
  return false;
}

type QueueItem = {
  id: number;
  title: string;
  summary: string | null;
  body: string | null;
  url: string;
  publishedAt: Date;
  sourceName: string;
  sourceKind: "rss" | "api" | "edgar";
  qualityWeight: string;
};

/**
 * Load the filing text for an EDGAR item that is about to be scored.
 *
 * EDGAR's feed gives a form type and a byte count, nothing else. Scoring a
 * merger from `425 - SYSCO CORP … Size: 974 KB` asks the model to price a deal
 * it cannot see, and it correctly answers with low confidence — which is how
 * genuinely major filings ended up scored in the teens.
 *
 * The fetch is deliberate about when it runs: only for items already selected
 * for a model call, so it never adds SEC traffic for items we score with
 * rules. The result is written back to `items.bodyText`, so a re-process or a
 * second signal on the same filing costs nothing further.
 */
async function enrichFilingBody(item: QueueItem): Promise<QueueItem> {
  if (item.sourceKind !== "edgar" || item.body) return item;

  const text = await fetchFilingText(item.url);
  if (!text) return item;

  await db().update(items).set({ bodyText: text }).where(eq(items.id, item.id));
  return { ...item, body: text };
}

async function modelScore(
  queued: QueueItem,
  runId: number,
  scoreModel: string,
  known: ReadonlySet<string>,
  owned: ReadonlySet<string>,
  now: Date,
): Promise<{ created: number; secondOrder: number; cost: number; triagedOut: boolean }> {
  let cost = 0;

  // Before triage, not after: a filing triaged out on its filename alone is a
  // signal lost permanently, and the extra tokens cost a fraction of a cent.
  const item = await enrichFilingBody(queued);

  const t = await triage(item, runId);
  cost += t.cost;
  if (!t.result.relevant) {
    return { created: 0, secondOrder: 0, cost, triagedOut: true };
  }

  const s = await scoreItem(item, runId, scoreModel);
  cost += s.cost;

  let created = 0;
  let secondOrder = 0;
  for (const signal of s.signals) {
    const wrote = await writeModelSignal(item, signal, s.model, known, owned, now);
    created += wrote;
    if (wrote && signal.isSecondOrder) secondOrder++;
  }
  return { created, secondOrder, cost, triagedOut: false };
}

async function writeModelSignal(
  item: QueueItem,
  signal: ScoredSignal,
  model: string,
  known: ReadonlySet<string>,
  owned: ReadonlySet<string>,
  now: Date,
): Promise<number> {
  const symbol = signal.symbol.trim().toUpperCase();
  // A symbol the model invented is worse than no symbol: it would attach a
  // confident-looking signal to a company that may not exist. Demote to a
  // sector signal rather than dropping the reasoning entirely.
  const validSymbol = symbol && known.has(symbol) ? symbol : null;
  const sector = signal.sector.trim() || null;
  if (!validSymbol && !sector) return 0;

  const scoreInputs = {
    magnitude: signal.magnitude,
    confidence: signal.confidence,
    sourceWeight: Number(item.qualityWeight),
  };
  const score = computeScore({
    ...scoreInputs,
    publishedAt: item.publishedAt,
    now,
    horizon: signal.horizon,
  });

  const inserted = await db()
    .insert(signals)
    .values({
      itemId: item.id,
      symbol: validSymbol,
      sector: validSymbol ? null : sector,
      eventType: signal.eventType,
      direction: signal.direction,
      magnitude: signal.magnitude,
      confidence: signal.confidence.toFixed(2),
      horizon: signal.horizon,
      score: score.toFixed(2),
      baseScore: computeBaseScore(scoreInputs).toFixed(2),
      rationale: signal.rationale,
      keyFacts: {
        secondOrder: signal.isSecondOrder,
        // Recorded when the model named a ticker we could not verify, so the
        // demotion is visible rather than silent.
        unverifiedSymbol: symbol && !known.has(symbol) ? symbol : undefined,
      },
      model,
      promptVersion: SCORE_PROMPT_VERSION,
    })
    .onConflictDoNothing({
      target: [signals.itemId, signals.symbol, signals.sector],
    })
    .returning({ id: signals.id });

  // Alert check happens here, at the single choke point every model signal
  // passes through — not in the UI, which would only alert on signals the
  // user happened to render. Rule signals never alert: their direction is
  // always neutral, which the alert rules exclude anyway.
  if (inserted.length > 0) {
    const reason = alertReasonFor(score, signal.direction, validSymbol, owned);
    if (reason) await recordAlert(inserted[0].id, reason);
  }

  return inserted.length;
}

/**
 * Rule-based signals. `model` is "rules" so /stats can separate these from
 * model-scored rows and never present the two as the same kind of claim.
 */
async function writeRuleSignals(
  item: QueueItem,
  matches: TickerMatch[],
  now: Date,
): Promise<number> {
  const prior = rulePrior(item.sourceName);
  const best = matches[0];
  const confidence = RULE_BASED_CONFIDENCE * best.confidence;

  const scoreInputs = {
    magnitude: prior.magnitude,
    confidence,
    sourceWeight: Number(item.qualityWeight),
  };
  const score = computeScore({
    ...scoreInputs,
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
      baseScore: computeBaseScore(scoreInputs).toFixed(2),
      rationale:
        `Rule-based match, no model reading. Ticker identified via ` +
        `${best.via.replace(/_/g, " ")}. Magnitude is a prior for this source ` +
        `type, not a judgement about the content, and direction is neutral ` +
        `because nothing has read the item.`,
      keyFacts: { matchedVia: best.via, matchConfidence: best.confidence },
      model: RULE_MODEL,
      promptVersion: RULE_PROMPT_VERSION,
    })
    .onConflictDoNothing({
      target: [signals.itemId, signals.symbol, signals.sector],
    })
    .returning({ id: signals.id });

  return inserted.length;
}

async function rows<T>(q: Promise<unknown>): Promise<T[]> {
  const result = (await q) as T[] | { rows: T[] };
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** Today's recorded LLM spend, UTC day. Read by the budget guard. */
export async function todaysLlmSpendUsd(): Promise<number> {
  const r = await rows<{ total: string }>(
    db().execute(
      sql`select coalesce(sum(cost_usd), 0)::text as total from llm_usage
          where created_at >= date_trunc('day', now() at time zone 'utc')`,
    ),
  );
  return Number(r[0]?.total ?? 0);
}

/** Spend recorded before this run started, so a run can report its own cost. */
async function todaysLlmSpendUsdBefore(startedAtMs: number): Promise<number> {
  const r = await rows<{ total: string }>(
    db().execute(
      sql`select coalesce(sum(cost_usd), 0)::text as total from llm_usage
          where created_at >= date_trunc('day', now() at time zone 'utc')
            and created_at < ${new Date(startedAtMs)}`,
    ),
  );
  return Number(r[0]?.total ?? 0);
}
