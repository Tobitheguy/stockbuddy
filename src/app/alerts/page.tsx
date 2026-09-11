import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { viewer } from "@/auth/viewer";
import { db } from "@/db/client";
import { alerts, items, signals } from "@/db/schema";
import { DirectionBadge } from "@/components/direction-badge";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { SignalScore } from "@/components/signal-score";
import { formatAge } from "@/lib/format";
import { liveScore } from "@/lib/live-score";
import { HELD_ALERT_MIN, RARE_ALERT_MIN } from "@/alerts/engine";
import { displayScore } from "@/scoring";
import type { Direction } from "@/lib/types";

/**
 * The interruptions, kept.
 *
 * This page works with zero external services — every alert is a database row
 * first and an email second. If email is configured, sent ones say so; if it
 * is not, this page IS the alert channel.
 */
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const { seesPositions } = await viewer();

  const rows = await db()
    .select({
      id: alerts.id,
      reason: alerts.reason,
      createdAt: alerts.createdAt,
      emailedAt: alerts.emailedAt,
      symbol: signals.symbol,
      sector: signals.sector,
      direction: signals.direction,
      // The live score, exactly as the feed computes it, plus the score the
      // alert actually fired on. Showing only the peak here made this page
      // disagree with the feed — an alert reading 72 while the same signal sat
      // at 32 on the front page, with nothing to explain the gap.
      score: liveScore(),
      peakScore: signals.baseScore,
      rationale: signals.rationale,
      title: items.title,
      url: items.canonicalUrl,
      publishedAt: items.publishedAt,
    })
    .from(alerts)
    .innerJoin(signals, eq(signals.id, alerts.signalId))
    .innerJoin(items, eq(items.id, signals.itemId))
    .orderBy(desc(alerts.createdAt))
    .limit(100);

  return (
    <>
      <PageTitle
        title="Alerts"
        subtitle={`Crossed the bar at ${RARE_ALERT_MIN}+ anywhere, or ${HELD_ALERT_MIN}+ on a position you hold. "Fired at" is the score at the time; "Now" is today, after age discounting.`}
      />

      {rows.length === 0 ? (
        <StatePanel
          title="No alerts yet"
          body={
            <>
              An alert fires when a directional signal reaches{" "}
              <strong>{RARE_ALERT_MIN}</strong> — the kind of event that happens
              a handful of times a month — or <strong>{HELD_ALERT_MIN}</strong>{" "}
              on a stock you have marked as <em>Owned</em> in the watchlist.
              Quiet is the normal state; this page existing is what lets the
              rest of the feed be read calmly.
            </>
          }
        />
      ) : (
        <TableScroller>
          <table className="table-dense w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Why</th>
                <th className="text-left">Ticker</th>
                <th className="text-left">Direction</th>
                <th className="text-left">Fired at</th>
                <th className="text-left">Now</th>
                <th className="text-left">Headline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num align-top whitespace-nowrap text-muted-foreground">
                    {formatAge(r.createdAt)}
                    {r.emailedAt ? (
                      <div className="text-[11px]">emailed</div>
                    ) : null}
                  </td>
                  <td className="align-top whitespace-nowrap text-[12px]">
                    {/* "held_strong" means the alert fired only because that
                        symbol is owned, so the badge names a holding as surely
                        as the watchlist column does. */}
                    {r.reason === "held_strong" && seesPositions ? (
                      <span className="rounded-md bg-bearish/10 px-1.5 py-0.5 font-medium text-bearish">
                        your position
                      </span>
                    ) : r.reason === "held_strong" ? (
                      <span className="rounded-md bg-surface px-1.5 py-0.5 text-muted-foreground">
                        threshold
                      </span>
                    ) : (
                      <span className="rounded-md bg-surface px-1.5 py-0.5 text-muted-foreground">
                        rare event
                      </span>
                    )}
                  </td>
                  <td className="align-top">
                    {r.symbol ? (
                      <Link
                        href={`/t/${r.symbol}`}
                        className="num font-medium hover:underline"
                      >
                        {r.symbol}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">
                        {r.sector}
                      </span>
                    )}
                  </td>
                  <td className="align-top">
                    <DirectionBadge direction={r.direction as Direction} />
                  </td>
                  {/*
                    Two columns, not one, and in this order.
                    An alert is a record of a moment: the score it FIRED at is
                    why the row exists, so that is the primary number. Showing
                    only the current score made a genuine 72 read as 32 with
                    nothing to explain why it had alerted at all; showing only
                    the peak made this page disagree with the feed. Both, each
                    labelled, is the only version that is not misleading.
                  */}
                  <td className="align-top">
                    <SignalScore
                      score={
                        r.peakScore === null ? Number(r.score) : Number(r.peakScore)
                      }
                      direction={r.direction as Direction}
                    />
                  </td>
                  <td className="align-top">
                    <span
                      className="num text-[14px] tabular-nums text-muted-foreground"
                      title="Today's score. It decays with age — an alert is a record of when it fired, not a claim about right now."
                    >
                      {displayScore(Number(r.score))}
                    </span>
                  </td>
                  <td className="max-w-[460px] align-top">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {r.title}
                    </a>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {r.rationale}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}

      <p className="mt-4 max-w-prose text-[12px] text-muted-foreground">
        To get these by email, create a free account at resend.com and set{" "}
        <code>RESEND_API_KEY</code> in the environment. Without it, alerts
        collect here and nothing is lost.
      </p>
    </>
  );
}
