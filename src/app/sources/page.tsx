import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { SEED_SOURCES } from "@/config/source-seed";

/**
 * CP1: renders the seed config directly.
 *
 * From Step 3 this page reads the `sources` table instead, and gains the live
 * health columns (last fetched, items/day, error count) plus the enable
 * toggle. Reading the static config now means the page is honest about what
 * exists rather than showing fabricated health numbers.
 */
export default function SourcesPage() {
  const enabled = SEED_SOURCES.filter((s) => s.enabled).length;

  return (
    <>
      <PageTitle
        title="Sources"
        subtitle={`${enabled} of ${SEED_SOURCES.length} enabled — health columns arrive with the scanner in Step 3.`}
      />

      <StatePanel
        className="mb-3"
        title="Seed configuration — no scan has run"
        body={
          <>
            Last-fetched, items/day and error counts are blank because the
            scanner does not exist yet. Business Wire and PR Newswire ship
            disabled: both refused the verification probe with a 403, so they
            stay off until a real fetch proves otherwise.
          </>
        }
      />

      <TableScroller>
        <table className="table-dense w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="text-left">Source</th>
              <th className="text-left">Kind</th>
              <th className="text-right">Interval</th>
              <th className="text-right">Weight</th>
              <th className="text-left">Body</th>
              <th className="text-left">Verified</th>
              <th className="text-left">State</th>
            </tr>
          </thead>
          <tbody>
            {SEED_SOURCES.map((s) => (
              <tr key={s.name}>
                <td>
                  <div className="font-medium">{s.name}</div>
                  <div className="max-w-[440px] text-[11px] text-muted-foreground">
                    {s.notes}
                  </div>
                </td>
                <td className="num text-[12px] text-muted-foreground uppercase">
                  {s.kind}
                </td>
                <td className="num text-right text-muted-foreground">
                  {s.pollIntervalSec}s
                </td>
                <td className="num text-right text-muted-foreground">
                  {s.qualityWeight.toFixed(2)}
                </td>
                <td className="text-[12px] text-muted-foreground">
                  {s.storeBody ? "full" : "summary"}
                </td>
                <td>
                  {/* Infra status uses ok/warn, never bullish/bearish — green
                      and red are reserved for market direction. */}
                  <span
                    className={
                      s.verified === "live"
                        ? "text-[12px] text-ok"
                        : "text-[12px] text-warn"
                    }
                  >
                    {s.verified === "live" ? "live" : "403"}
                  </span>
                </td>
                <td className="text-[12px]">
                  {s.enabled ? (
                    <span className="text-foreground">enabled</span>
                  ) : (
                    <span className="text-muted-foreground">disabled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </>
  );
}
