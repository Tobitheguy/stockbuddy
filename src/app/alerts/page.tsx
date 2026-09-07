import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { alerts, items, signals } from "@/db/schema";
import { DirectionBadge } from "@/components/direction-badge";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { SignalScore } from "@/components/signal-score";
import { formatAge } from "@/lib/format";
import { HELD_ALERT_MIN, RARE_ALERT_MIN } from "@/alerts/engine";
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
  const rows = await db()
    .select({
      id: alerts.id,
      reason: alerts.reason,
      createdAt: alerts.createdAt,
      emailedAt: alerts.emailedAt,
      symbol: signals.symbol,
      sector: signals.sector,
      direction: signals.direction,
      score: sql<string>`coalesce(${signals.baseScore}, ${signals.score})`,
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
        subtitle={`Signals that crossed the alert bar: ${RARE_ALERT_MIN}+ anywhere, or ${HELD_ALERT_MIN}+ on a position you hold.`}
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
                <th className="text-left">Score</th>
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
                    {r.reason === "held_strong" ? (
                      <span className="rounded-md bg-bearish/10 px-1.5 py-0.5 font-medium text-bearish">
                        your position
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
                  <td className="align-top">
                    <SignalScore
                      score={Number(r.score)}
                      direction={r.direction as Direction}
                      showBand={false}
                    />
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
