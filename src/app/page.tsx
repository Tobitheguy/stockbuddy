import Link from "next/link";
import { DirectionBadge } from "@/components/direction-badge";
import { SignalScore } from "@/components/signal-score";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { EVENT_TYPE_LABEL, type Direction, type EventType } from "@/lib/types";
import { formatAge } from "@/lib/format";

/**
 * CP1: layout preview only.
 *
 * These rows are hardcoded so the design foundation can be reviewed before the
 * database exists. The real feed — sorting, filters, and the expandable "why"
 * row — is wired to Postgres in Step 5. Nothing here calls an API or an LLM.
 */
type PreviewRow = {
  symbol: string | null;
  company: string;
  headline: string;
  eventType: EventType;
  direction: Direction;
  score: number;
  publishedAt: string;
  source: string;
};

const PREVIEW: PreviewRow[] = [
  {
    symbol: "BWXT",
    company: "BWX Technologies",
    headline:
      "Awarded $2.6 billion U.S. Navy contract for naval nuclear reactor components",
    eventType: "contract_win",
    direction: "bullish",
    score: 87,
    publishedAt: "2026-09-06T13:00:00Z",
    source: "GlobeNewswire",
  },
  {
    symbol: "NUE",
    company: "Nucor",
    headline:
      "Section 232 steel tariff raised to 50%; domestic producers gain a price umbrella",
    eventType: "regulatory_policy",
    direction: "bullish",
    score: 74,
    publishedAt: "2026-09-06T09:15:00Z",
    source: "Federal Register",
  },
  {
    symbol: null,
    company: "Homebuilding (sector)",
    headline:
      "Section 232 steel tariff raised to 50%; steel-consuming manufacturers absorb input cost",
    eventType: "regulatory_policy",
    direction: "bearish",
    score: 61,
    publishedAt: "2026-09-06T09:15:00Z",
    source: "Federal Register",
  },
  {
    symbol: "AEP",
    company: "American Electric Power",
    headline:
      "1.2 GW hyperscale campus sited in central Ohio adds material new load",
    eventType: "contract_win",
    direction: "bullish",
    score: 58,
    publishedAt: "2026-09-06T12:15:00Z",
    source: "GlobeNewswire",
  },
  {
    symbol: "ROIV",
    company: "Roivant Sciences",
    headline:
      "To present topline Phase 2 PHocus results at ERS Congress — announcement only, no data yet",
    eventType: "product_launch",
    direction: "neutral",
    score: 22,
    publishedAt: "2026-09-06T05:00:00Z",
    source: "GlobeNewswire",
  },
  {
    symbol: "VZ",
    company: "Verizon",
    headline: "Waives charges for Hurricane Lowell, prepares network in Hawai'i",
    eventType: "other",
    direction: "neutral",
    score: 6,
    publishedAt: "2026-09-05T21:29:00Z",
    source: "GlobeNewswire",
  },
];

// Fixed "now" so the Age column is stable across builds and does not make the
// page non-deterministic during CP1 review.
const PREVIEW_NOW = new Date("2026-09-06T23:00:00Z");

export default function SignalsPage() {
  return (
    <>
      <PageTitle
        title="Signals"
        subtitle="Ranked by score. Every row links to its source."
      />

      <StatePanel
        className="mb-3"
        title="Layout preview — not live data"
        body={
          <>
            These six rows are hardcoded to show the design foundation. The
            scanner, scorer and database land in Steps 3–5; until then nothing
            on this page is real.
          </>
        }
      />

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
            {PREVIEW.map((row, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">
                  {row.symbol ? (
                    <Link
                      href={`/t/${row.symbol}`}
                      className="num font-medium hover:underline"
                    >
                      {row.symbol}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      sector
                    </span>
                  )}
                  <div className="text-[12px] text-muted-foreground">
                    {row.company}
                  </div>
                </td>
                <td className="max-w-[520px]">{row.headline}</td>
                <td className="whitespace-nowrap text-[13px] text-muted-foreground">
                  {EVENT_TYPE_LABEL[row.eventType]}
                </td>
                <td>
                  <DirectionBadge direction={row.direction} />
                </td>
                <td>
                  <SignalScore score={row.score} direction={row.direction} />
                </td>
                <td className="num text-right text-muted-foreground">
                  {formatAge(row.publishedAt, PREVIEW_NOW)}
                </td>
                <td className="whitespace-nowrap text-[13px] text-muted-foreground">
                  {row.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </>
  );
}
