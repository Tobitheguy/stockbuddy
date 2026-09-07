import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { scanRuns, sources } from "@/db/schema";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { formatAge, formatPT } from "@/lib/format";

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
  const failing = enabled.filter((r) => r.lastError);
  const healthy = enabled.length - failing.length;

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
              {healthy} are healthy. A failing source never stops the others —
              the scan completes regardless. Errors are shown per row below.
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
                      {r.lastError.slice(0, 180)}
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
