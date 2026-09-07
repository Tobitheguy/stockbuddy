import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { items, signals, sources, tickers, watchlist } from "@/db/schema";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { DirectionBadge } from "@/components/direction-badge";
import { SignalScore } from "@/components/signal-score";
import { Sparkline } from "@/components/sparkline";
import { WatchlistButton } from "@/components/watchlist-button";
import { closesFor, pctReturn } from "@/market/prices";
import { EVENT_TYPE_LABEL, type Direction, type EventType } from "@/lib/types";
import { formatAge, formatPT, formatPrice, formatReturn } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TickerPage({ params }: PageProps<"/t/[symbol]">) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();

  const [ticker] = await db()
    .select()
    .from(tickers)
    .where(eq(tickers.symbol, symbol))
    .limit(1);

  if (!ticker) notFound();

  const [watched] = await db()
    .select()
    .from(watchlist)
    .where(eq(watchlist.symbol, symbol))
    .limit(1);

  const closes = await closesFor(symbol, 90);

  const rows = await db()
    .select({
      id: signals.id,
      eventType: signals.eventType,
      direction: signals.direction,
      score: signals.score,
      confidence: signals.confidence,
      magnitude: signals.magnitude,
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
    .where(eq(signals.symbol, symbol))
    .orderBy(desc(items.publishedAt))
    .limit(50);

  const latest = closes.at(-1)?.close ?? null;
  const entry = watched?.priceAtAdd ? Number(watched.priceAtAdd) : null;
  const sinceAdd = pctReturn(entry, latest);

  return (
    <>
      <PageTitle
        title={symbol}
        subtitle={ticker.name}
        actions={
          <WatchlistButton
            symbol={symbol}
            initiallyWatched={Boolean(watched)}
            size="lg"
          />
        }
      />

      {/* ---- Facts row -------------------------------------------------- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Fact
          label="Latest close we have"
          value={latest !== null ? `$${formatPrice(latest)}` : "—"}
          hint={
            closes.length
              ? `as of ${closes.at(-1)!.marketDate}`
              : "no price recorded yet"
          }
        />
        <Fact
          label="Your entry price"
          value={entry !== null ? `$${formatPrice(entry)}` : "—"}
          hint={
            watched
              ? entry !== null
                ? `captured ${formatPT(watched.priceAtAddAt ?? watched.addedAt)}`
                : "could not be captured when added"
              : "not on your watchlist"
          }
        />
        <Fact
          label="Since you added it"
          value={sinceAdd !== null ? formatReturn(sinceAdd) : "—"}
          tone={sinceAdd === null ? "flat" : sinceAdd >= 0 ? "up" : "down"}
          hint={
            sinceAdd !== null
              ? "your decision, measured"
              : "needs an entry price and a later close"
          }
        />
      </div>

      {/* ---- Chart ------------------------------------------------------ */}
      <section className="mb-5 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Price</h2>
        {closes.length >= 2 ? (
          <>
            <Sparkline points={closes} height={90} />
            <div className="num mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{closes[0].marketDate}</span>
              <span>
                {closes.length} trading day{closes.length === 1 ? "" : "s"} recorded
              </span>
              <span>{closes.at(-1)!.marketDate}</span>
            </div>
          </>
        ) : (
          <p className="max-w-prose text-[13px] text-muted-foreground">
            No chart yet — and this is expected rather than broken. The free
            market-data tier gives live quotes but not history, so this chart is
            built from prices recorded once a day going forward. It fills in
            over the following weeks. Nothing that has already happened is
            missing from the signals below.
          </p>
        )}
      </section>

      {/* ---- Plain-language explainer ----------------------------------- */}
      <section className="mb-5 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold">
          What you are looking at
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <Explain term="Signal">
            One piece of news, and what it might mean for this company. It is a
            prompt for your own research, never a recommendation.
          </Explain>
          <Explain term="Direction">
            Whether the news reads as good (bullish), bad (bearish) or unclear
            (neutral) for the share price. Neutral is a real answer, not a
            failure.
          </Explain>
          <Explain term="Score, 0–100">
            How much attention the row deserves. It combines how big the event
            could be, how confident the reasoning is, how close the source is
            to the original document, and how recent it is.
          </Explain>
          <Explain term="Magnitude, 1–5">
            How much this could move the share price. 5 is reserved for things
            that reprice a company, like a takeover.
          </Explain>
          <Explain term="Confidence, 0–1">
            How sure the reasoning is — and whether the market has likely
            priced it already. A rumour scores lower than a filed document.
          </Explain>
          <Explain term="Since you added it">
            The change from the price recorded the moment you clicked add. This
            is the honest scoreboard for your own decisions.
          </Explain>
        </dl>
      </section>

      {/* ---- Signals ----------------------------------------------------- */}
      <h2 className="mb-2 text-[14px] font-semibold">
        Signals for {symbol}{" "}
        <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>

      {rows.length === 0 ? (
        <StatePanel
          title="No signals for this company yet"
          body="It will appear here as soon as one of the 40 sources publishes something about it."
        />
      ) : (
        <TableScroller>
          <table className="table-dense w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left">Headline</th>
                <th className="text-left">Type</th>
                <th className="text-left">Direction</th>
                <th className="text-left">Score</th>
                <th className="text-right">Age</th>
                <th className="text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-[560px] align-top">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {r.title}
                    </a>
                    <div className="mt-1 max-w-[560px] text-[12px] text-muted-foreground">
                      {r.rationale}
                    </div>
                  </td>
                  <td className="whitespace-nowrap align-top text-[13px] text-muted-foreground">
                    {EVENT_TYPE_LABEL[r.eventType as EventType]}
                  </td>
                  <td className="align-top">
                    <DirectionBadge direction={r.direction as Direction} />
                  </td>
                  <td className="align-top">
                    <SignalScore
                      score={Number(r.score)}
                      direction={r.direction as Direction}
                    />
                  </td>
                  <td className="num align-top text-right text-muted-foreground">
                    {formatAge(r.publishedAt)}
                  </td>
                  <td className="whitespace-nowrap align-top text-[13px] text-muted-foreground">
                    {r.sourceName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </>
  );
}

function Fact({
  label,
  value,
  hint,
  tone = "flat",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={
          "num mt-1 text-[20px] font-semibold " +
          (tone === "up"
            ? "text-bullish"
            : tone === "down"
              ? "text-bearish"
              : "text-foreground")
        }
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function Explain({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}
