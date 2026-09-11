import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { viewer } from "@/auth/viewer";
import { db } from "@/db/client";
import { items, scanRuns, signals, sources, tickers, watchlist } from "@/db/schema";
import { DirectionBadge } from "@/components/direction-badge";
import { ScoreLegend } from "@/components/score-legend";
import { SignalScore } from "@/components/signal-score";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { EVENT_TYPE_LABEL, type Direction, type EventType } from "@/lib/types";
import { formatAge } from "@/lib/format";
import { liveScore } from "@/lib/live-score";
import { WatchlistButton } from "@/components/watchlist-button";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

/**
 * Two orderings, both legitimate:
 *
 *   top     the default — what deserves attention, score-ranked with decay
 *           computed against the current clock.
 *   newest  what just happened, pure recency. This is the "did anything come
 *           in since I last looked" view; score still shows on every row, it
 *           just does not drive the order.
 */
export type FeedSort = "top" | "newest";
export type FeedDir = "all" | "bullish" | "bearish";

type FeedFilters = {
  sort: FeedSort;
  dir: FeedDir;
  /** Only symbols marked Owned on the watchlist. */
  held: boolean;
};

async function loadSignals({ sort, dir, held }: FeedFilters) {
  return db()
    .select({
      id: signals.id,
      symbol: signals.symbol,
      companyName: tickers.name,
      eventType: signals.eventType,
      direction: signals.direction,
      // Decayed against the clock right now, not against the clock at the
      // moment the row was written — otherwise Monday's signal outranks
      // Friday's forever and the feed slowly stops being a feed.
      score: liveScore(),
      peakScore: signals.baseScore,
      rationale: signals.rationale,
      model: signals.model,
      title: items.title,
      url: items.canonicalUrl,
      publishedAt: items.publishedAt,
      sourceName: sources.name,
    })
    .from(signals)
    .innerJoin(items, eq(items.id, signals.itemId))
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(tickers, eq(tickers.symbol, signals.symbol))
    .where(
      and(
        dir === "all" ? undefined : eq(signals.direction, dir),
        held
          ? sql`${signals.symbol} in (select symbol from watchlist where is_owned)`
          : undefined,
      ),
    )
    .orderBy(
      ...(sort === "newest"
        ? // Tie-break new items of the same minute by score, so a batch of
          // simultaneous filings still surfaces its most important one first.
          [desc(items.publishedAt), desc(liveScore())]
        : [desc(liveScore()), desc(items.publishedAt)]),
    )
    .limit(PAGE_SIZE);
}

/**
 * The reason scoring is currently degraded, or null when it is healthy.
 *
 * This exists because the failure it catches is invisible from everywhere
 * else. When the model becomes unusable — exhausted credit, a revoked key —
 * ingestion carries on, runs keep succeeding, items keep arriving, and every
 * new item quietly falls back to rule-based scoring. Nothing turns red. The
 * only symptom is that the feed stops gaining anything with a direction on it,
 * which reads as a quiet news day until you compare timestamps.
 *
 * It happened for two days before anyone noticed. The reason was sitting in
 * scan_runs.error the whole time, written on every run, read by nobody.
 *
 * Deliberately keyed to the most recent run rather than to a count of
 * rule-scored rows: a bad key is a fact about right now, and the moment a run
 * succeeds the banner should disappear on its own without a backlog of
 * fallback rows keeping it lit.
 */
async function latestScoringFault(): Promise<string | null> {
  const [run] = await db()
    .select({ error: scanRuns.error, startedAt: scanRuns.startedAt })
    .from(scanRuns)
    .where(eq(scanRuns.kind, "process"))
    .orderBy(desc(scanRuns.startedAt))
    .limit(1);

  if (!run?.error) return null;
  return `${run.error} (last attempt ${formatAge(run.startedAt)} ago)`;
}

/** Build a feed URL that changes one filter and keeps the rest. */
function feedHref(filters: FeedFilters, patch: Partial<FeedFilters>): string {
  const next = { ...filters, ...patch };
  const q = new URLSearchParams();
  if (next.sort === "newest") q.set("sort", "newest");
  if (next.dir !== "all") q.set("dir", next.dir);
  if (next.held) q.set("held", "1");
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

/**
 * The feed controls, as a full-width bar rather than a corner widget.
 *
 * The first version was a small toggle tucked into the title row; the user
 * looked straight past it and reported sorting as broken. A control nobody
 * finds is a control that does not exist — this one sits where the eye enters
 * the table.
 */
function FeedControls({
  filters,
  seesPositions,
}: {
  filters: FeedFilters;
  seesPositions: boolean;
}) {
  const pill = (active: boolean) =>
    "rounded-md px-3 py-1.5 text-[13px] transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
    (active
      ? "bg-foreground text-background font-medium"
      : "bg-surface text-muted-foreground hover:bg-surface-raised hover:text-foreground");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5" role="group" aria-label="Sort">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Sort
        </span>
        <Link href={feedHref(filters, { sort: "top" })} className={pill(filters.sort === "top")}>
          Top
        </Link>
        <Link
          href={feedHref(filters, { sort: "newest" })}
          className={pill(filters.sort === "newest")}
        >
          Newest
        </Link>
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Direction">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Direction
        </span>
        <Link href={feedHref(filters, { dir: "all" })} className={pill(filters.dir === "all")}>
          All
        </Link>
        <Link
          href={feedHref(filters, { dir: "bullish" })}
          className={pill(filters.dir === "bullish")}
        >
          ▲ Bullish
        </Link>
        <Link
          href={feedHref(filters, { dir: "bearish" })}
          className={pill(filters.dir === "bearish")}
        >
          ▼ Bearish
        </Link>
      </div>

      {seesPositions ? (
        <Link
          href={feedHref(filters, { held: !filters.held })}
          aria-pressed={filters.held}
          className={pill(filters.held)}
        >
          My positions only
        </Link>
      ) : null}
    </div>
  );
}

export default async function SignalsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const { canWrite, seesPositions } = await viewer();

  const sort: FeedSort = params.sort === "newest" ? "newest" : "top";
  const dir: FeedDir =
    params.dir === "bullish" || params.dir === "bearish" ? params.dir : "all";
  // `?held=1` filters the feed down to held symbols, which answers "what does
  // he own" just as directly as the hidden column would. Hiding the pill is
  // not enough — the parameter has to stop working too.
  const held = params.held === "1" && seesPositions;
  const filters: FeedFilters = { sort, dir, held };

  let rows: Awaited<ReturnType<typeof loadSignals>>;
  let totals = { signals: 0, ruleScored: 0 };
  let watched = new Set<string>();
  let scoringFault: string | null = null;

  try {
    rows = await loadSignals(filters);
    const counts = await db()
      .select({
        total: sql<number>`count(*)::int`,
        rules: sql<number>`count(*) filter (where ${signals.model} = 'rules')::int`,
      })
      .from(signals);
    totals = { signals: counts[0]?.total ?? 0, ruleScored: counts[0]?.rules ?? 0 };
    scoringFault = await latestScoringFault();
    watched = new Set(
      (await db().select({ symbol: watchlist.symbol }).from(watchlist)).map(
        (r) => r.symbol,
      ),
    );
  } catch (err) {
    return (
      <>
        <PageTitle title="Signals" />
        <StatePanel
          tone="error"
          title="Cannot reach the database"
          body={
            <div className="num text-[11px]">
              {err instanceof Error ? err.message.slice(0, 200) : "unknown error"}
            </div>
          }
        />
      </>
    );
  }

  if (rows.length === 0) {
    const filtered = dir !== "all" || held;
    return (
      <>
        <PageTitle title="Signals" />
        {filtered ? (
          <FeedControls filters={filters} seesPositions={seesPositions} />
        ) : null}
        <StatePanel
          title={filtered ? "Nothing matches these filters" : "No signals yet"}
          body={
            filtered ? (
              held && dir === "all" ? (
                <>
                  No signals on your held positions yet. Mark holdings with the{" "}
                  <em>Owned</em> toggle on the watchlist — or widen the filter.
                </>
              ) : (
                <>Try widening the direction filter or switching off “My positions only”.</>
              )
            ) : (
              <>
                Run <code>npm run scan</code> to collect items, then{" "}
                <code>npm run process</code> to turn them into signals. Once
                the cron jobs are live this happens by itself.
              </>
            )
          }
        />
      </>
    );
  }

  const allRuleScored = totals.ruleScored === totals.signals;

  return (
    <>
      <PageTitle
        title="Signals"
        subtitle={
          sort === "newest"
            ? `${totals.signals} signals. Newest first — score shown but not driving the order.`
            : `${totals.signals} signals. Ranked by score — magnitude × confidence × source quality × recency.`
        }
      />

      <FeedControls filters={filters} seesPositions={seesPositions} />
      <ScoreLegend />

      {scoringFault ? (
        <StatePanel
          className="mb-4"
          tone="error"
          title="Scoring is degraded — new rows are rule-based only"
          body={
            <>
              The last processing run could not reach the model, so anything
              arriving since then has been ranked by rules alone and carries no
              direction. Ingestion is unaffected; the feed is still current, it
              is just not being read. <strong>{scoringFault}</strong>
            </>
          }
        />
      ) : null}

      {allRuleScored ? (
        <StatePanel
          className="mb-4"
          title="Rule-based mode — no AI scoring"
          body={
            <>
              Every row below was matched and ranked by rules alone, at zero
              cost. <strong>Direction is neutral everywhere because nothing
              has read the content</strong> — a guessed direction would be a
              coin flip dressed up as a judgement. Set{" "}
              <code>SCORING_MODE</code> to have Claude read each item and
              supply direction, magnitude and reasoning.
            </>
          }
        />
      ) : null}

      <TableScroller>
        <table className="table-dense w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left">Ticker</th>
              <th className="text-left">Headline</th>
              <th className="text-left">Type</th>
              <th className="text-left">Direction</th>
              <th className="text-left">Score</th>
              <th className="text-right">Age</th>
              <th className="text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap align-top">
                  {row.symbol ? (
                    <span className="flex items-center gap-1.5">
                      {canWrite ? (
                        <WatchlistButton
                          symbol={row.symbol}
                          initiallyWatched={watched.has(row.symbol)}
                        />
                      ) : null}
                      <Link
                        href={`/t/${row.symbol}`}
                        className="num font-medium hover:underline"
                      >
                        {row.symbol}
                      </Link>
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">sector</span>
                  )}
                  {row.companyName ? (
                    <div className="max-w-[190px] truncate text-[12px] text-muted-foreground">
                      {row.companyName}
                    </div>
                  ) : null}
                </td>
                <td className="max-w-[520px] align-top">
                  {/* Every signal links to its source. Non-negotiable: these
                      are prompts for your own research, not conclusions. */}
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {row.title}
                  </a>
                </td>
                <td className="whitespace-nowrap align-top text-[13px] text-muted-foreground">
                  {EVENT_TYPE_LABEL[row.eventType as EventType]}
                </td>
                <td className="align-top">
                  <DirectionBadge direction={row.direction as Direction} />
                </td>
                <td className="align-top">
                  <SignalScore
                    score={Number(row.score)}
                    direction={row.direction as Direction}
                  />
                </td>
                <td className="num align-top text-right text-muted-foreground">
                  {formatAge(row.publishedAt)}
                </td>
                <td className="whitespace-nowrap align-top text-[13px] text-muted-foreground">
                  {row.sourceName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <p className="mt-4 text-[12px] text-muted-foreground">
        Showing the top {rows.length} of {totals.signals}. Every headline links
        to its original source.
      </p>
    </>
  );
}
