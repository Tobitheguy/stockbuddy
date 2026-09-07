import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, signals, sources, tickers, watchlist } from "@/db/schema";
import { DirectionBadge } from "@/components/direction-badge";
import { SignalScore } from "@/components/signal-score";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { EVENT_TYPE_LABEL, type Direction, type EventType } from "@/lib/types";
import { formatAge } from "@/lib/format";
import { WatchlistButton } from "@/components/watchlist-button";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

async function loadSignals() {
  return db()
    .select({
      id: signals.id,
      symbol: signals.symbol,
      companyName: tickers.name,
      eventType: signals.eventType,
      direction: signals.direction,
      score: signals.score,
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
    .orderBy(desc(signals.score), desc(items.publishedAt))
    .limit(PAGE_SIZE);
}

export default async function SignalsPage() {
  let rows: Awaited<ReturnType<typeof loadSignals>>;
  let totals = { signals: 0, ruleScored: 0 };
  let watched = new Set<string>();

  try {
    rows = await loadSignals();
    const counts = await db()
      .select({
        total: sql<number>`count(*)::int`,
        rules: sql<number>`count(*) filter (where ${signals.model} = 'rules')::int`,
      })
      .from(signals);
    totals = { signals: counts[0]?.total ?? 0, ruleScored: counts[0]?.rules ?? 0 };
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
    return (
      <>
        <PageTitle title="Signals" />
        <StatePanel
          title="No signals yet"
          body={
            <>
              Run <code>npm run scan</code> to collect items, then{" "}
              <code>npm run process</code> to turn them into signals. Once the
              cron jobs are live this happens by itself.
            </>
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
        subtitle={`${totals.signals} signals. Ranked by score — magnitude × confidence × source quality × recency.`}
      />

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
                      <WatchlistButton
                        symbol={row.symbol}
                        initiallyWatched={watched.has(row.symbol)}
                      />
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
