import { cn } from "@/lib/utils";
import type { Direction } from "@/lib/types";

const STYLES: Record<Direction, string> = {
  bullish: "bg-bullish-dim text-bullish",
  bearish: "bg-bearish-dim text-bearish",
  neutral: "bg-neutral-dim text-neutral",
};

// Color alone must never be the only carrier of meaning — roughly 1 in 12 men
// has some red/green deficiency, and this is a red/green product. Every badge
// pairs the color with a glyph and a text label.
const GLYPH: Record<Direction, string> = {
  bullish: "▲",
  bearish: "▼",
  neutral: "■",
};

const LABEL: Record<Direction, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

export function DirectionBadge({
  direction,
  className,
}: {
  direction: Direction;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        STYLES[direction],
        className,
      )}
    >
      <span aria-hidden className="text-[9px] leading-none">
        {GLYPH[direction]}
      </span>
      {LABEL[direction]}
    </span>
  );
}
