import { cn } from "@/lib/utils";
import type { Direction } from "@/lib/types";

/**
 * Score cell: the number, plus a bar giving the eye something to scan down.
 *
 * Scores run 0-100. The bar is intentionally low-contrast — it is there to
 * make the shape of the column readable at a glance, not to shout.
 */
export function SignalScore({
  score,
  direction,
  className,
}: {
  score: number;
  direction: Direction;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const barColor =
    direction === "bullish"
      ? "bg-bullish"
      : direction === "bearish"
        ? "bg-bearish"
        : "bg-neutral";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="num w-7 text-right text-[14px] font-medium tabular-nums">
        {Math.round(clamped)}
      </span>
      <span
        className="h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-surface-raised"
        role="img"
        aria-label={`Score ${Math.round(clamped)} of 100`}
      >
        <span
          className={cn("block h-full rounded-full opacity-85", barColor)}
          style={{ width: `${clamped}%` }}
        />
      </span>
    </div>
  );
}
