import { desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { items, signals, sources, tickers, watchlist } from "@/db/schema";
import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import { DirectionBadge } from "@/components/direction-badge";
import { PriceChart } from "@/components/price-chart";
import { SignalScore } from "@/components/signal-score";
import { WatchlistButton } from "@/components/watchlist-button";
import { daysUntilLabel, nextEarnings } from "@/market/earnings";
import { chartCloses, ensureHistory } from "@/market/history";
import { pctReturn } from "@/market/prices";
import { capBucket, ensureProfile } from "@/market/profile";
import { riskContext, volatilityLabel } from "@/market/risk";
import { displayScore, scoreBand } from "@/scoring";
import { liveScore } from "@/lib/live-score";
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

  // Backfill up to five years of daily closes on first view (one provider
  // call, then cached in our own prices table). Failure is deliberately
  // swallowed: a missing chart must never take down the signals below it.
  await ensureHistory(symbol).catch(() => undefined);
  const [closes, profile, earnings] = await Promise.all([
    chartCloses(symbol),
    ensureProfile(symbol).catch(() => null),
    nextEarnings(symbol).catch(() => null),
  ]);
  const risk = riskContext(closes);

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

  // The current read: the strongest live-scored signal of the last 7 days
  // drives the plain-language summary, with the week's direction tally as
  // context. Live-scored, so yesterday's story does not keep the headline.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const recent = await db()
    .select({
      liveScore: liveScore(),
      direction: signals.direction,
      rationale: signals.rationale,
      eventType: signals.eventType,
    })
    .from(signals)
    .innerJoin(items, eq(items.id, signals.itemId))
    .where(
      sql`${signals.symbol} = ${symbol} and ${items.publishedAt} >= ${weekAgo} and ${signals.model} <> 'rules'`,
    )
    .orderBy(desc(liveScore()))
    .limit(25);

  const top = recent[0] ?? null;
  const tally = {
    bullish: recent.filter((r) => r.direction === "bullish").length,
    bearish: recent.filter((r) => r.direction === "bearish").length,
    neutral: recent.filter((r) => r.direction === "neutral").length,
  };

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
          <PriceChart points={closes} />
        ) : (
          <p className="max-w-prose text-[13px] text-muted-foreground">
            No chart for this symbol — the history provider returned nothing
            for it, which usually means a very recent listing or a delisting.
            The signals below are unaffected.
          </p>
        )}
      </section>

      {/* ---- Current read ------------------------------------------------ */}
      {top ? (
        <section className="mb-5 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-[13px] font-semibold">
            The current read{" "}
            <span className="font-normal text-muted-foreground">
              — last 7 days, in plain language
            </span>
          </h2>
          <CurrentRead top={top} tally={tally} symbol={symbol} />
        </section>
      ) : null}

      {/* ---- Company + risk context -------------------------------------- */}
      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-[13px] font-semibold">About the company</h2>
          {profile ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Meta label="Industry" value={profile.industry ?? "—"} />
              <Meta
                label="Size"
                value={
                  profile.marketCapM !== null
                    ? `$${formatMarketCap(profile.marketCapM)}${
                        capBucket(profile.marketCapM)
                          ? ` · ${capBucket(profile.marketCapM)!.label}`
                          : ""
                      }`
                    : "—"
                }
              />
              <Meta
                label="Listed"
                value={
                  profile.ipoDate
                    ? `since ${profile.ipoDate.slice(0, 4)}`
                    : "—"
                }
              />
              <Meta label="Exchange" value={shortExchange(profile.exchange)} />
              {earnings ? (
                <Meta
                  label="Next earnings"
                  value={`${daysUntilLabel(earnings.reportDate)} (${earnings.reportDate}${earnings.hour === "amc" ? ", after close" : earnings.hour === "bmo" ? ", before open" : ""})`}
                  highlight
                />
              ) : null}
              {profile.website ? (
                <div className="col-span-2">
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-muted-foreground hover:underline"
                  >
                    {profile.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No profile available for this symbol.
            </p>
          )}
          {capBucket(profile?.marketCapM ?? null) ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {capBucket(profile!.marketCapM)!.note}.
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-[13px] font-semibold">
            How rough is the ride
          </h2>
          {risk ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <Meta
                  label="Volatility (1y)"
                  value={`${risk.annualVolPct.toFixed(0)}% · ${volatilityLabel(risk.annualVolPct).label}`}
                />
                <Meta
                  label="Worst fall (1y)"
                  value={`${risk.maxDrawdownPct.toFixed(0)}%`}
                />
                <Meta
                  label="52-week range"
                  value={`$${formatPrice(risk.fiftyTwoWeekLow)} – $${formatPrice(risk.fiftyTwoWeekHigh)}`}
                />
                <Meta
                  label="Today sits at"
                  value={`${risk.rangePositionPct.toFixed(0)}% of that range`}
                />
              </dl>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {volatilityLabel(risk.annualVolPct).note}. These are measured
                facts about past behaviour — context for your own judgement,
                never a recommendation. Whether and how much to invest is your
                decision alone.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Not enough price history yet to compute risk figures.
            </p>
          )}
        </section>
      </div>

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

/**
 * Band + direction, translated into sentences a non-expert can act on.
 *
 * This exists because "Strong · Bearish" confused the tool's own user into
 * asking whether it meant "invest". Score answers HOW IMPORTANT; direction
 * answers WHICH WAY. The combination has to be spelled out in words, once,
 * where the person is actually looking.
 */
function CurrentRead({
  top,
  tally,
  symbol,
}: {
  top: {
    liveScore: number;
    direction: string;
    rationale: string;
    eventType: string;
  };
  tally: { bullish: number; bearish: number; neutral: number };
  symbol: string;
}) {
  const shown = displayScore(Number(top.liveScore));
  const band = scoreBand(shown);

  const directionText =
    top.direction === "bullish"
      ? `reads POSITIVE for the share price — the kind of setup worth researching as a potential opportunity`
      : top.direction === "bearish"
        ? `reads NEGATIVE for the share price — treat it as a warning, not an invitation to buy`
        : `has no clear direction yet — the event is real but which way it cuts is genuinely open`;

  const mixed =
    tally.bullish > 0 && tally.bearish > 0
      ? ` The week is mixed — ${tally.bullish} bullish and ${tally.bearish} bearish signal(s) — so read both sides before forming a view.`
      : "";

  return (
    <>
      <p className="text-[13px] leading-relaxed">
        The strongest current signal on {symbol} scores{" "}
        <strong>
          {shown} ({band.label})
        </strong>{" "}
        and {directionText}.{mixed}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Why:</strong> {top.rationale}
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        &ldquo;{band.label}&rdquo; measures how much attention this deserves,
        not whether to invest — that judgement, and the responsibility for it,
        stays with you. This tool never gives investment advice.
      </p>
    </>
  );
}

function Meta({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={highlight ? "font-medium" : undefined}>{value}</dd>
    </div>
  );
}

function formatMarketCap(millions: number): string {
  if (millions >= 1_000_000) return `${(millions / 1_000_000).toFixed(1)}T`;
  if (millions >= 1_000) return `${(millions / 1_000).toFixed(1)}B`;
  return `${millions.toFixed(0)}M`;
}

function shortExchange(exchange: string | null): string {
  if (!exchange) return "—";
  if (/new york stock exchange/i.test(exchange)) return "NYSE";
  if (/nasdaq/i.test(exchange)) return "Nasdaq";
  return exchange.length > 18 ? exchange.slice(0, 18) + "…" : exchange;
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
