import { cn } from "@/lib/utils";
import type { Direction } from "@/lib/types";
import { displayScore, scoreBand } from "@/scoring";

/**
 * Score cell: the number, a band label, and a bar.
 *
 * Receives the RAW stored score and renders the display transform — the gamma
 * stretch lives in exactly one place (displayScore in scoring.ts) so every
 * surface shows the same number for the same signal. The raw value stays in
 * the database and in /stats, where comparability across time matters more
 * than readability.
 */

/**
 * Full bar at this displayed score rather than at 100. Above ~75 displayed
 * (raw ~62) is genuinely exceptional, so a full bar means something.
 */
const DISPLAY_CEILING = 75;

export function SignalScore({
  score,
  peakScore,
  direction,
  className,
  showBand = true,
}: {
  /** Raw stored score, 0-100. The display transform is applied here. */
  score: number;
  /**
   * The undecayed score, when known. Shown as "was N" once age has pulled the
   * live score materially below it — otherwise a strong find from yesterday
   * looks like a weak find from today, with nothing on screen to explain the
   * difference. The live score still drives ranking and colour; this is
   * context, not a second ranking.
   */
  peakScore?: number;
  direction: Direction;
  className?: string;
  /** Off in dense contexts where the label would not fit. */
  showBand?: boolean;
}) {
  const shown = displayScore(score);
  const band = scoreBand(shown);
  const fill = Math.min(100, (shown / DISPLAY_CEILING) * 100);
  const peak = peakScore === undefined ? null : displayScore(peakScore);
  // Only worth saying when the gap is big enough to change the reading.
  const showPeak = peak !== null && peak - shown >= 8;

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
        {shown}
      </span>
      <span
        className="h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-surface-raised"
        role="img"
        aria-label={`Score ${shown}: ${band.label}. ${band.blurb}`}
      >
        <span
          className={cn("block h-full rounded-full opacity-85", barColor)}
          style={{ width: `${fill}%` }}
        />
      </span>
      {showBand ? (
        <span className="hidden w-24 shrink-0 text-[11px] text-muted-foreground sm:inline">
          {band.label}
          {showPeak ? (
            <span
              className="ml-1 opacity-70"
              title={`Scored ${peak} when it was published; the score decays with age.`}
            >
              (was {peak})
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
