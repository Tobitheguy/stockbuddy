import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { scanRuns, sources } from "@/db/schema";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { formatAge, formatPT } from "@/lib/format";
import { redactEmails } from "@/lib/redact";

/**
 * Live source health.
 *
 * Reads the database rather than the seed config, so this page reflects what
 * the scanner actually experienced — including feeds that are failing right
 * now. That is the whole point: a source list that only shows intent is not
 * health monitoring.
 */
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  name: string;
  kind: string;
  enabled: boolean;
  pollIntervalSec: number;
  qualityWeight: string;
  storeBody: boolean;
  lastFetchedAt: Date | null;
  lastError: string | null;
  errorStreak: number;
  itemCount: number;
  itemsLast24h: number;
  prefilteredCount: number;
};

async function loadRows(): Promise<Row[]> {
  return db()
    .select({
      id: sources.id,
      name: sources.name,
      kind: sources.kind,
      enabled: sources.enabled,
      pollIntervalSec: sources.pollIntervalSec,
      qualityWeight: sources.qualityWeight,
      storeBody: sources.storeBody,
      lastFetchedAt: sources.lastFetchedAt,
      lastError: sources.lastError,
      errorStreak: sources.errorStreak,
      // Written as literal identifiers rather than Drizzle table
      // interpolation: interpolating `${items}` into a correlated subquery
      // rendered something that returned 1 for every row. The raw form below
      // is verified against the database. No user input is involved.
      itemCount: sql<number>`(select count(*)::int from items where items.source_id = sources.id)`,
      itemsLast24h: sql<number>`(select count(*)::int from items where items.source_id = sources.id and items.fetched_at > now() - interval '24 hours')`,
      prefilteredCount: sql<number>`(select count(*)::int from items where items.source_id = sources.id and items.prefilter_reason is not null)`,
    })
    .from(sources)
    .orderBy(desc(sources.enabled), sources.name);
}

export default async function SourcesPage() {
  let rows: Row[];
  let lastRun: { startedAt: Date; sourcesOk: number; sourcesFailed: number; itemsNew: number } | null =
    null;

  try {
    rows = await loadRows();
    const runs = await db()
      .select({
        startedAt: scanRuns.startedAt,
        sourcesOk: scanRuns.sourcesOk,
        sourcesFailed: scanRuns.sourcesFailed,
        itemsNew: scanRuns.itemsNew,
      })
      .from(scanRuns)
      /*
       * The most recent FINISHED run of kind 'scan', specifically. Both
       * filters fix a header that regularly claimed the scanner was dead.
       *
       * Without the kind filter it took whatever ran last, which is usually a
       * 'process' run — those never touch a source, so sources_ok and
       * sources_failed are 0 by construction while items_new is populated.
       * The page rendered that as "0 ok, 0 failed, 82 new items".
       *
       * Without the finished_at filter it read runs still in flight, whose
       * counters are all still 0. A scan takes about a minute of every ten,
       * so roughly one page load in ten showed "0 ok, 0 failed, 0 new items"
       * on a scanner that was working perfectly — the worst possible moment
       * being a first impression.
       */
      .where(and(eq(scanRuns.kind, "scan"), isNotNull(scanRuns.finishedAt)))
      .orderBy(desc(scanRuns.startedAt))
      .limit(1);
    lastRun = runs[0] ?? null;
  } catch (err) {
    return (
      <>
        <PageTitle title="Sources" />
        <StatePanel
          tone="error"
          title="Cannot reach the database"
          body={
            <>
              The source list lives in Postgres. Check that DATABASE_URL is set
              and that the migration has been applied (
              <code>npm run db:migrate</code>).
              <div className="num mt-2 text-[11px]">
                {err instanceof Error ? err.message.slice(0, 200) : "unknown error"}
              </div>
            </>
          }
        />
      </>
    );
  }

  const enabled = rows.filter((r) => r.enabled);

  /*
   * A feed is "failing" once it has missed more than once in a row, not on a
   * single miss.
   *
   * Polling 26 feeds every few minutes means one is essentially always
   * mid-timeout — a transient SEC blip that clears on the next fetch. Counting
   * those turned the banner permanently red on a scanner that was fine, which
   * trains the reader to ignore it and hides the case it exists for: a feed
   * that is genuinely gone.
   *
   * The per-row status below still shows the single miss, so nothing is
   * concealed. This governs only whether the page shouts about it.
   */
  const failing = enabled.filter((r) => r.lastError && r.errorStreak > 1);
  const blipping = enabled.filter((r) => r.lastError && r.errorStreak <= 1);
  const healthy = enabled.length - failing.length - blipping.length;

  return (
    <>
      <PageTitle
        title="Sources"
        subtitle={
          lastRun
            ? `Last scan ${formatPT(lastRun.startedAt)} — ${lastRun.sourcesOk} ok, ${lastRun.sourcesFailed} failed, ${lastRun.itemsNew} new items.`
            : "No scan has run yet."
        }
      />

      {failing.length > 0 ? (
        <StatePanel
          className="mb-4"
          tone="error"
          title={`${failing.length} of ${enabled.length} enabled sources are failing`}
          body={
            <>
              {healthy} are healthy
              {blipping.length > 0
                ? `, ${blipping.length} missed a single fetch and will retry`
                : ""}
              . A failing source never stops the others — the scan completes
              regardless. Errors are shown per row below.
            </>
          }
        />
      ) : null}

      <TableScroller>
        <table className="table-dense w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left">Source</th>
              <th className="text-left">Kind</th>
              <th className="text-right">Every</th>
              <th className="text-right">Weight</th>
              <th className="text-right">Items</th>
              <th className="text-right">24h</th>
              <th className="text-right">Filtered</th>
              <th className="text-right">Last fetch</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.enabled ? "" : "opacity-55"}>
                <td>
                  <div className="font-medium">{r.name}</div>
                  {r.lastError ? (
                    <div className="mt-0.5 max-w-[520px] text-[12px] text-bearish">
                      {redactEmails(r.lastError).slice(0, 180)}
                      {r.errorStreak > 1 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (failed {r.errorStreak}× in a row)
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="num text-[12px] font-medium text-muted-foreground uppercase">
                  {r.kind}
                </td>
                <td className="num text-right text-muted-foreground">
                  {r.pollIntervalSec >= 3600
                    ? `${r.pollIntervalSec / 3600}h`
                    : r.pollIntervalSec >= 60
                      ? `${r.pollIntervalSec / 60}m`
                      : `${r.pollIntervalSec}s`}
                </td>
                <td className="num text-right text-muted-foreground">
                  {Number(r.qualityWeight).toFixed(2)}
                </td>
                <td className="num text-right">{r.itemCount || "—"}</td>
                <td className="num text-right text-muted-foreground">
                  {r.itemsLast24h || "—"}
                </td>
                <td
                  className="num text-right text-muted-foreground"
                  title="Dropped by free rules before any model call"
                >
                  {r.prefilteredCount || "—"}
                </td>
                <td className="num text-right text-muted-foreground">
                  {r.lastFetchedAt ? formatAge(r.lastFetchedAt) : "never"}
                </td>
                <td className="text-[12px]">
                  {!r.enabled ? (
                    <span className="text-muted-foreground">off</span>
                  ) : r.lastError ? (
                    <span className="text-warn">failing</span>
                  ) : r.lastFetchedAt ? (
                    <span className="text-ok">ok</span>
                  ) : (
                    <span className="text-muted-foreground">pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <p className="mt-4 max-w-prose text-[12px] text-muted-foreground">
        <strong>Filtered</strong> counts items dropped by free rules before any
        model call — routine insider vesting, non-English releases, and the same
        story arriving from a second outlet. They are stored with the reason
        rather than discarded, so the filter can be audited rather than trusted.
      </p>
    </>
  );
}
