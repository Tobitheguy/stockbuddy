import {
  MIN_COMPARABLES,
  type Comparables,
  type TypicalMove,
} from "@/market/expectations";
import { EVENT_TYPE_LABEL, type EventType } from "@/lib/types";

/**
 * Scale, not prediction.
 *
 * The question this answers is "how far could it go", asked by someone who
 * knows they cannot be told. The only honest answers are distributions of
 * things that already happened, so both halves are explicitly historical and
 * neither is ever phrased as an expectation. The comparables half refuses to
 * summarise below MIN_COMPARABLES rather than turn three observations into a
 * median that reads like a finding.
 */

function pct(n: number, sign = false): string {
  const s = n >= 0 && sign ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

export function ExpectationPanel({
  symbol,
  move5,
  move20,
  comps,
  eventType,
  direction,
}: {
  symbol: string;
  move5: TypicalMove | null;
  move20: TypicalMove | null;
  comps: Comparables | null;
  eventType: string | null;
  direction: string | null;
}) {
  const enough = comps !== null && comps.measured >= MIN_COMPARABLES;

  return (
    <section className="mb-5 rounded-lg border border-border bg-card p-4">
      <h2 className="text-[13px] font-semibold">
        How far does {symbol} usually move
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Measured from the past year. This is the scale of ordinary moves — it
        is not a target and not a forecast.
      </p>

      {move5 || move20 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[move5, move20].filter(Boolean).map((m) => (
            <div
              key={m!.days}
              className="rounded-md border border-border bg-surface px-3 py-2"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                over {m!.days} trading days
              </p>
              <p className="mt-1 text-[13px]">
                Half of all moves stayed within{" "}
                <strong className="num">±{pct(m!.medianAbsPct)}</strong>, nine
                in ten within <strong className="num">±{pct(m!.p90AbsPct)}</strong>.
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Biggest in the year:{" "}
                <span className="num text-bullish">{pct(m!.bestPct, true)}</span>{" "}
                and{" "}
                <span className="num text-bearish">{pct(m!.worstPct, true)}</span>.
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Not enough price history for this symbol yet.
        </p>
      )}

      {eventType && direction ? (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-[12px] font-semibold">
            What followed comparable signals
          </h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Every past {direction} {EVENT_TYPE_LABEL[eventType as EventType] ?? eventType}{" "}
            signal this tool produced, measured five trading days later. This is
            the tool&apos;s own track record — it can just as easily show the
            calls were wrong.
          </p>

          {enough ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              <span>
                <strong className="num">{comps!.measured}</strong> measured
              </span>
              <span>
                median 5d:{" "}
                <strong
                  className={
                    "num " +
                    ((comps!.medianReturn5d ?? 0) >= 0
                      ? "text-bullish"
                      : "text-bearish")
                  }
                >
                  {comps!.medianReturn5d === null
                    ? "—"
                    : pct(comps!.medianReturn5d, true)}
                </strong>
              </span>
              <span className="text-muted-foreground">
                range {comps!.worstReturn5d === null ? "—" : pct(comps!.worstReturn5d, true)}{" "}
                to {comps!.bestReturn5d === null ? "—" : pct(comps!.bestReturn5d, true)}
              </span>
              <span>
                direction right:{" "}
                <strong className="num">
                  {comps!.hitRate === null
                    ? "—"
                    : `${(comps!.hitRate * 100).toFixed(0)}%`}
                </strong>
              </span>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {comps?.measured ?? 0} of {MIN_COMPARABLES} needed measurements so
              far. A signal takes five trading days to settle, so this fills in
              about a week after the signals themselves. Until then there is no
              track record to show, and inventing one from two or three cases
              would read like a finding while being noise.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
