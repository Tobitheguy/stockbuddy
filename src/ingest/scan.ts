import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, scanRuns, sources, type Source } from "@/db/schema";
import { fetchApi } from "@/sources/apis";
import { fetchEdgar } from "@/sources/edgar";
import { fetchRss } from "@/sources/rss";
import type { RawItem } from "@/sources/types";
import { canonicalizeUrl, contentHash, storyKey, urlHash } from "@/lib/hash";
import { prefilter, type PrefilterReason } from "./prefilter";

/**
 * One scan cycle.
 *
 * Contract:
 *  - One failing source NEVER aborts the run. Failures are recorded against
 *    that source and the rest continue.
 *  - Running twice in a row inserts zero duplicate items.
 *  - Nothing is dropped silently: prefiltered items are stored with the reason.
 */

export type SourceOutcome = {
  source: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  prefiltered: number;
  durationMs: number;
  error?: string;
  warnings: string[];
};

export type ScanSummary = {
  runId: number;
  sourcesOk: number;
  sourcesFailed: number;
  sourcesSkipped: number;
  itemsNew: number;
  itemsPrefiltered: number;
  durationMs: number;
  outcomes: SourceOutcome[];
};

/** How long a story key blocks later copies from other outlets. */
const STORY_WINDOW_HOURS = 48;

/** Per-source wall clock. A hung feed must not eat the function's budget. */
const PER_SOURCE_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Story clustering is for EDITORIAL sources only.
 *
 * `kind: "rss"` is exactly the wires and news outlets — the places where a
 * near-identical headline really does mean a second outlet carrying the same
 * story. EDGAR (`kind: "edgar"`) and the structured databases (`kind: "api"`)
 * have formulaic titles where identical wording is normal and means nothing,
 * so clustering there destroys real filings. See the note in prefilter.ts.
 */
function allowsStoryClustering(source: Source): boolean {
  return source.kind === "rss";
}

async function fetchSource(source: Source) {
  const opts = { storeBody: source.storeBody };
  switch (source.kind) {
    case "edgar":
      return fetchEdgar(source.url, opts);
    case "api":
      return fetchApi(source.url);
    case "rss":
      return fetchRss(source.url, opts);
  }
}

/**
 * How long a source with `n` consecutive failures must wait before the next
 * attempt: its own interval, doubled once per failure, capped at six hours.
 *
 * `error_streak` was being written on every failure and read by nothing, so a
 * feed that had been unreachable for days was still retried on its normal
 * interval forever. Three dead GlobeNewswire feeds on a 60-second interval
 * cost three 20-second timeouts on every single scan — most of the run's
 * wall-clock, spent on hosts that had not answered in 600 consecutive tries.
 *
 * The cap matters as much as the growth. Without it, a feed that breaks for a
 * week backs off past the point of ever being retried, and a source that comes
 * back stays dark until someone notices by hand. Six hours means a recovered
 * feed rejoins the same day on its own.
 */
const MAX_BACKOFF_SEC = 6 * 60 * 60;

/**
 * Sources due for a poll: enabled, and either never fetched or last fetched
 * longer ago than their interval — extended by the failure backoff above.
 */
async function dueSources(force: boolean): Promise<Source[]> {
  const database = db();
  if (force) {
    return database.select().from(sources).where(eq(sources.enabled, true));
  }
  return database
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        or(
          sql`${sources.lastFetchedAt} is null`,
          /*
           * The exponent is capped at 10 before the multiply, not after. The
           * cap on the result would be reached either way, but 2^600 as a
           * double times a 3600-second interval overflows int4 on the way
           * there, and Postgres raises rather than saturating.
           */
          sql`${sources.lastFetchedAt} < now() - make_interval(secs => least(
                ${sources.pollIntervalSec} * power(2, least(${sources.errorStreak}, 10))::int,
                ${MAX_BACKOFF_SEC}
              ))`,
        ),
      ),
    );
}

/** Story keys already claimed recently, so a later outlet does not re-pay. */
async function recentStoryKeys(): Promise<Set<string>> {
  const since = new Date(Date.now() - STORY_WINDOW_HOURS * 3600_000);
  const rows = await db()
    .select({ key: items.storyKey })
    .from(items)
    .where(and(isNotNull(items.storyKey), gte(items.publishedAt, since)));
  return new Set(rows.map((r) => r.key!).filter(Boolean));
}

export async function runScan(
  opts: { force?: boolean } = {},
): Promise<ScanSummary> {
  const database = db();
  const startedAt = Date.now();

  const [run] = await database
    .insert(scanRuns)
    .values({ kind: "scan" })
    .returning({ id: scanRuns.id });

  const due = await dueSources(opts.force ?? false);
  const [{ count: enabledCount }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(eq(sources.enabled, true));

  const seenStoryKeys = await recentStoryKeys();
  const outcomes: SourceOutcome[] = [];

  // Sequential rather than parallel: EDGAR is rate-limited anyway, and a
  // serverless function has a modest connection budget. Predictability beats
  // a few saved seconds when the whole thing runs unattended.
  for (const source of due) {
    const t0 = Date.now();
    const outcome: SourceOutcome = {
      source: source.name,
      ok: false,
      fetched: 0,
      inserted: 0,
      prefiltered: 0,
      durationMs: 0,
      warnings: [],
    };

    try {
      const result = await withTimeout(
        fetchSource(source),
        PER_SOURCE_TIMEOUT_MS,
        source.name,
      );
      outcome.fetched = result.items.length;
      outcome.warnings = result.warnings;

      const { inserted, prefiltered } = await persist(
        source,
        result.items,
        seenStoryKeys,
      );
      outcome.inserted = inserted;
      outcome.prefiltered = prefiltered;
      outcome.ok = true;

      await database
        .update(sources)
        .set({ lastFetchedAt: new Date(), lastError: null, errorStreak: 0 })
        .where(eq(sources.id, source.id));
    } catch (err) {
      // Contract: one bad source must not take down the run.
      const message = err instanceof Error ? err.message : String(err);
      outcome.error = message.slice(0, 500);
      await database
        .update(sources)
        .set({
          lastFetchedAt: new Date(),
          lastError: outcome.error,
          errorStreak: sql`${sources.errorStreak} + 1`,
        })
        .where(eq(sources.id, source.id));
    }

    outcome.durationMs = Date.now() - t0;
    outcomes.push(outcome);
  }

  const sourcesOk = outcomes.filter((o) => o.ok).length;
  const sourcesFailed = outcomes.length - sourcesOk;
  const itemsNew = outcomes.reduce((n, o) => n + o.inserted, 0);
  const itemsPrefiltered = outcomes.reduce((n, o) => n + o.prefiltered, 0);
  const durationMs = Date.now() - startedAt;

  await database
    .update(scanRuns)
    .set({
      finishedAt: new Date(),
      sourcesOk,
      sourcesFailed,
      itemsNew,
      itemsPrefiltered,
    })
    .where(eq(scanRuns.id, run.id));

  return {
    runId: run.id,
    sourcesOk,
    sourcesFailed,
    sourcesSkipped: enabledCount - due.length,
    itemsNew,
    itemsPrefiltered,
    durationMs,
    outcomes,
  };
}

/**
 * Normalize, dedupe and store one source's items.
 *
 * Three dedupe layers, cheapest first:
 *   1. canonical URL   — unique index; the same document fetched twice
 *   2. content hash    — same text republished at a new URL
 *   3. story key       — the same STORY from a different outlet
 */
async function persist(
  source: Source,
  raw: RawItem[],
  seenStoryKeys: Set<string>,
): Promise<{ inserted: number; prefiltered: number }> {
  if (raw.length === 0) return { inserted: 0, prefiltered: 0 };
  const database = db();

  // Deduplicate within this batch first — feeds do repeat themselves.
  const byUrl = new Map<string, RawItem>();
  for (const item of raw) {
    const key = canonicalizeUrl(item.url);
    if (!byUrl.has(key)) byUrl.set(key, item);
  }

  // Which of these do we already hold? One query instead of N.
  const canonicalUrls = [...byUrl.keys()];
  const existing = new Set(
    (
      await database
        .select({ url: items.canonicalUrl })
        .from(items)
        .where(inArray(items.canonicalUrl, canonicalUrls))
    ).map((r) => r.url),
  );

  const contentHashes = [...byUrl.values()].map((i) =>
    contentHash(i.title, i.summary),
  );
  const existingContent = new Set(
    (
      await database
        .select({ h: items.contentHash })
        .from(items)
        .where(inArray(items.contentHash, contentHashes))
    ).map((r) => r.h),
  );

  const rows: (typeof items.$inferInsert)[] = [];
  let prefiltered = 0;

  for (const [canonical, item] of byUrl) {
    if (existing.has(canonical)) continue;

    const cHash = contentHash(item.title, item.summary);
    if (existingContent.has(cHash)) continue;
    existingContent.add(cHash); // guard against repeats inside this batch

    const key = storyKey(item.title);
    const verdict = prefilter({
      title: item.title,
      summary: item.summary,
      sourceName: source.name,
      storyKey: key,
      seenStoryKeys,
      allowStoryClustering: allowsStoryClustering(source),
    });

    // Claim the story key so later sources in the same run see it taken.
    if (key && !verdict.drop) seenStoryKeys.add(key);
    if (verdict.drop) prefiltered++;

    rows.push({
      sourceId: source.id,
      canonicalUrl: canonical,
      urlHash: urlHash(item.url),
      title: item.title.slice(0, 1000),
      summary: item.summary ?? null,
      // Enforced a second time here: an adapter bug must not be able to make
      // us store a third-party article body.
      bodyText: source.storeBody ? (item.body ?? null) : null,
      publishedAt: item.publishedAt,
      contentHash: cHash,
      storyKey: key,
      prefilterReason: verdict.drop
        ? (verdict.reason satisfies PrefilterReason)
        : null,
    });
  }

  if (rows.length === 0) return { inserted: 0, prefiltered };

  // onConflictDoNothing makes a concurrent scan harmless rather than a crash.
  const inserted = await database
    .insert(items)
    .values(rows)
    .onConflictDoNothing({ target: items.canonicalUrl })
    .returning({ id: items.id });

  return { inserted: inserted.length, prefiltered };
}
