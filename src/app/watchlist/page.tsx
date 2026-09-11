import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { viewer } from "@/auth/viewer";
import { db } from "@/db/client";
import { tickers, watchlist } from "@/db/schema";
import { OwnedToggle } from "@/components/owned-toggle";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { WatchlistButton } from "@/components/watchlist-button";
import { pctReturn } from "@/market/prices";
import { formatPrice, formatPT, formatReturn } from "@/lib/format";

/**
 * The watchlist — and the scoreboard for your own decisions.
 *
 * "Return since added" is measured from the price captured the moment you
 * clicked add, not from a signal. It is the most direct answer available to
 * "is this tool actually reliable", because it grades the decisions you made
 * using it rather than the model's opinions.
 */
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const { canWrite, seesPositions, signedIn } = await viewer();

  const rows = await db()
    .select({
      symbol: watchlist.symbol,
      name: tickers.name,
      note: watchlist.note,
      isOwned: watchlist.isOwned,
      addedAt: watchlist.addedAt,
      priceAtAdd: watchlist.priceAtAdd,
      priceAtAddAt: watchlist.priceAtAddAt,
      latestClose: sql<string | null>`(
        select close from prices
        where prices.symbol = watchlist.symbol
        order by market_date desc limit 1
      )`,
      latestDate: sql<string | null>`(
        select market_date from prices
        where prices.symbol = watchlist.symbol
        order by market_date desc limit 1
      )`,
      signalCount: sql<number>`(
        select count(*)::int from signals where signals.symbol = watchlist.symbol
      )`,
    })
    .from(watchlist)
    .leftJoin(tickers, eq(tickers.symbol, watchlist.symbol))
    // Positions actually held come first — those rows are exposure, not
    // curiosity, and must never require scrolling to find. For a visitor who
    // is not shown holdings, that ordering would leak the same fact the hidden
    // column withholds, so they get plain add order instead.
    .orderBy(
      ...(seesPositions
        ? [desc(watchlist.isOwned), asc(watchlist.addedAt)]
        : [asc(watchlist.addedAt)]),
    );

  if (rows.length === 0) {
    return (
      <>
        <PageTitle title="Watchlist" />
        <StatePanel
          title="Nothing on the watchlist yet"
          body={
            <>
              Press <strong>+</strong> next to any ticker in the signal feed, or
              on a company page. The moment you do, the current price is
              recorded — so this page can then show you what has happened{" "}
              <em>since your decision</em>, which is the honest way to find out
              whether this tool is worth trusting.
            </>
          }
        />
      </>
    );
  }

  const measured = rows.filter((r) => r.priceAtAdd && r.latestClose);
  const winners = measured.filter(
    (r) => pctReturn(Number(r.priceAtAdd), Number(r.latestClose))! > 0,
  ).length;

  return (
    <>
      <PageTitle
        title="Watchlist"
        subtitle={[
          `${rows.length} tracked`,
          seesPositions && rows.some((r) => r.isOwned)
            ? `${rows.filter((r) => r.isOwned).length} held`
            : null,
          measured.length > 0
            ? `${winners} of ${measured.length} up since you added them`
            : `returns appear once a later price has been recorded`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <TableScroller>
        <table className="table-dense w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left">Ticker</th>
              {seesPositions ? <th className="text-left">Status</th> : null}
              <th className="text-right">Entry price</th>
              <th className="text-right">Latest</th>
              <th className="text-right">Since added</th>
              <th className="text-right">Signals</th>
              <th className="text-left">Added</th>
              {canWrite ? <th className="text-left"></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const entry = r.priceAtAdd ? Number(r.priceAtAdd) : null;
              const latest = r.latestClose ? Number(r.latestClose) : null;
              const ret = pctReturn(entry, latest);
              return (
                <tr key={r.symbol}>
                  <td className="align-top">
                    <Link
                      href={`/t/${r.symbol}`}
                      className="num font-medium hover:underline"
                    >
                      {r.symbol}
                    </Link>
                    <div className="max-w-[220px] truncate text-[12px] text-muted-foreground">
                      {r.name ?? "—"}
                    </div>
                    {/* Free-text personal annotation. Never shown to a visitor
                        who is not signed in — there is no telling what a note
                        says, so it is not the place to start guessing. */}
                    {signedIn && r.note ? (
                      <div className="mt-0.5 max-w-[260px] text-[12px] text-muted-foreground italic">
                        {r.note}
                      </div>
                    ) : null}
                  </td>
                  {seesPositions ? (
                    <td className="align-top">
                      <OwnedToggle
                        symbol={r.symbol}
                        initiallyOwned={r.isOwned}
                        readOnly={!canWrite}
                      />
                    </td>
                  ) : null}
                  <td className="num align-top text-right">
                    {entry !== null ? `$${formatPrice(entry)}` : (
                      <span
                        className="text-muted-foreground"
                        title="The price could not be captured when this symbol was added"
                      >
                        not captured
                      </span>
                    )}
                  </td>
                  <td className="num align-top text-right">
                    {latest !== null ? `$${formatPrice(latest)}` : "—"}
                    {r.latestDate ? (
                      <div className="text-[11px] text-muted-foreground">
                        {r.latestDate}
                      </div>
                    ) : null}
                  </td>
                  <td
                    className={
                      "num align-top text-right font-medium " +
                      (ret === null
                        ? "text-muted-foreground"
                        : ret >= 0
                          ? "text-bullish"
                          : "text-bearish")
                    }
                  >
                    {formatReturn(ret)}
                  </td>
                  <td className="num align-top text-right text-muted-foreground">
                    {r.signalCount || "—"}
                  </td>
                  <td className="align-top text-[12px] text-muted-foreground">
                    {formatPT(r.addedAt)}
                  </td>
                  {canWrite ? (
                    <td className="align-top">
                      <WatchlistButton symbol={r.symbol} initiallyWatched />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>

      <p className="mt-4 max-w-prose text-[12px] text-muted-foreground">
        <strong>Since added</strong> is measured from the price captured the
        moment you pressed +, against the most recent close recorded. It grades
        your decisions, not the model&apos;s opinions — which is the more
        useful question. Prices are recorded once a day, so this is not a live
        quote.
      </p>
    </>
  );
}
