import { cn } from "@/lib/utils";
import type { Direction } from "@/lib/types";
import { scoreBand } from "@/scoring";

/**
 * Score cell: the number, a band label, and a bar.
 *
 * THE BAR IS NOT SCALED TO 100, AND THAT IS DELIBERATE. The score is a product
 * of four factors each below 1, so 100 requires a magnitude-5 event, near-total
 * confidence, a primary source and minutes-old timing simultaneously. Measured
 * on live data the best signal of a normal day lands in the low-to-mid 30s.
 *
 * A bar drawn against 100 rendered that as one third full, which reads as a
 * failing grade for the single most important item in the feed — the visual
 * said "ignore this" about exactly the row the page exists to surface. Scaling
 * against a realistic ceiling and naming the band fixes the reading without
 * touching the number, which stays honest and comparable.
 */

/**
 * Full bar at this score. Chosen from the observed distribution, not to
 * flatter: above this is genuinely rare, so a full bar means something.
 */
const DISPLAY_CEILING = 50;

export function SignalScore({
  score,
  direction,
  className,
  showBand = true,
}: {
  score: number;
  direction: Direction;
  className?: string;
  /** Off in dense contexts where the label would not fit. */
  showBand?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = scoreBand(clamped);
  const fill = Math.min(100, (clamped / DISPLAY_CEILING) * 100);

  const barColor =
    direction === "bullish"
      ? "bg-bullish"
      : direction === "bearish"
        ? "bg-bearish"
        : "bg-neutral";

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title={`${band.label} — ${band.blurb}`}
    >
      <span className="num w-7 text-right text-[14px] font-medium tabular-nums">
        {Math.round(clamped)}
      </span>
      <span
        className="h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-surface-raised"
        role="img"
        aria-label={`Score ${Math.round(clamped)}: ${band.label}. ${band.blurb}`}
      >
        <span
          className={cn("block h-full rounded-full opacity-85", barColor)}
          style={{ width: `${fill}%` }}
        />
      </span>
      {showBand ? (
        <span className="hidden w-16 shrink-0 text-[11px] text-muted-foreground sm:inline">
          {band.label}
        </span>
      ) : null}
    </div>
  );
}
