import { PageTitle, StatePanel, TableScroller } from "@/components/page-shell";
import {
  byConfidence,
  byEventType,
  byModel,
  bySource,
  daily,
  MIN_RELIABLE_N,
  overview,
  type Breakdown,
} from "@/stats/queries";
import { cn } from "@/lib/utils";

/**
 * The scorecard on the tool itself.
 *
 * Reads live every time. A cached scorecard is worse than none: it would keep
 * showing yesterday's hit rate on a page whose entire purpose is telling you
 * whether to believe today's signals.
 */
export const dynamic = "force-dynamic";

function pct(v: number | null, digits = 0): string {
  return v === null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function signedPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function BreakdownTable({
  title,
  caption,
  rows,
}: {
  title: string;
  caption: string;
  rows: Breakdown[];
}) {
  const anyMeasured = rows.some((r) => r.measured > 0);

  return (
    <section className="mt-6">
      <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 mb-2 max-w-prose text-[12px] text-muted-foreground">
        {caption}
      </p>

      {rows.length === 0 ? (
        <StatePanel title="Nothing here yet" />
      ) : (
        <TableScroller>
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{title}</th>
                <th className="py-1.5 pr-3 text-right font-medium">Signals</th>
                <th className="py-1.5 pr-3 text-right font-medium">Judged</th>
                <th className="py-1.5 pr-3 text-right font-medium">Hit rate</th>
                <th className="py-1.5 text-right font-medium">Avg 5d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const thin = r.measured > 0 && r.measured < MIN_RELIABLE_N;
                return (
                  <tr key={r.label} className="border-b border-border/60">
                    <td className="py-1.5 pr-3">{r.label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {r.signals}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {r.measured}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-3 text-right tabular-nums",
                        thin && "text-muted-foreground",
                      )}
                      title={
                        thin
                          ? `Only ${r.measured} judged signals — too few to read as a rate.`
                          : undefined
                      }
                    >
                      {pct(r.hitRate)}
                      {thin ? " *" : ""}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right tabular-nums",
                        r.avgReturn5d === null
                          ? "text-muted-foreground"
                          : r.avgReturn5d > 0
                            ? "text-bullish"
                            : r.avgReturn5d < 0
                              ? "text-bearish"
                              : undefined,
                      )}
                    >
                      {signedPct(r.avgReturn5d)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}

      {anyMeasured ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          * fewer than {MIN_RELIABLE_N} judged signals — not yet a meaningful
          rate.
        </p>
      ) : null}
    </section>
  );
}

export default async function StatsPage() {
  // One round trip rather than six sequential ones.
  const [o, events, sources, confidence, models, days] = await Promise.all([
    overview(),
    byEventType(),
    bySource(),
    byConfidence(),
    byModel(),
    daily(),
  ]);

  const maxSignals = Math.max(1, ...days.map((d) => d.signals));

  return (
    <>
      <PageTitle
        title="Stats"
        subtitle="Whether the signals were right, measured against actual closes."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Signals"
          value={String(o.signalsTotal)}
          hint={`${o.signalsModel} model, ${o.signalsRules} rules`}
        />
        <Stat
          label="Judged"
          value={String(o.measured)}
          hint={`${o.pending} awaiting +5 days`}
        />
        <Stat
          label="Hit rate 5d"
          value={
            o.measured >= MIN_RELIABLE_N ? pct(o.hitRate5d, 1) : "—"
          }
          hint={
            o.measured >= MIN_RELIABLE_N
              ? "directional calls only"
              : `needs ${MIN_RELIABLE_N} judged`
          }
        />
        <Stat
          label="Avg return 5d"
          value={signedPct(o.avgReturn5d)}
          hint="across judged signals"
        />
        <Stat
          label="LLM spend"
          value={`$${o.costTotalUsd.toFixed(2)}`}
          hint={`$${o.costTodayUsd.toFixed(2)} today`}
        />
      </div>

      {o.measured === 0 ? (
        <StatePanel
          className="mt-6"
          title="No signal has been judged yet"
          body={
            <>
              A signal needs five trading days of closes before it can be
              scored as right or wrong, and the price job records one close per
              symbol per day. Expect the tables below to stay empty for about a
              week after the first scan. Volume and spend are already live.
            </>
          }
        />
      ) : null}

      <BreakdownTable
        title="By confidence"
        caption="The test of whether the model's own confidence means anything. High-confidence signals should be right more often than low-confidence ones; if they are not, treat the number as decoration."
        rows={confidence}
      />

      <BreakdownTable
        title="By event type"
        caption="Which kinds of catalyst this tool reads well. Neutral signals are excluded — they make no directional claim to be right or wrong about."
        rows={events}
      />

      <BreakdownTable
        title="By source"
        caption="Which feeds earn their place. A source with many signals and a poor hit rate is costing money and attention."
        rows={sources}
      />

      <BreakdownTable
        title="By model and prompt"
        caption="Every signal records the prompt version that produced it, so a prompt change can be judged against measured outcomes rather than taste."
        rows={models}
      />

      <section className="mt-6">
        <h2 className="text-[14px] font-semibold tracking-tight">
          Last 14 days
        </h2>
        <p className="mt-0.5 mb-2 max-w-prose text-[12px] text-muted-foreground">
          Signals produced and what they cost.
        </p>
        <TableScroller>
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Day</th>
                <th className="py-1.5 pr-3 text-right font-medium">Signals</th>
                <th className="w-1/2 py-1.5 pr-3 font-medium" />
                <th className="py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                    {d.day}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {d.signals}
                  </td>
                  <td className="py-1.5 pr-3">
                    <div
                      aria-hidden
                      className="h-1.5 rounded-full bg-bullish/70"
                      style={{
                        width: `${(d.signals / maxSignals) * 100}%`,
                        minWidth: d.signals > 0 ? "2px" : "0",
                      }}
                    />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {d.costUsd > 0 ? `$${d.costUsd.toFixed(3)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </>
  );
}
