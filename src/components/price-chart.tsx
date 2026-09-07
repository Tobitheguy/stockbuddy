"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";

/**
 * The standard stock chart: a close line with range tabs.
 *
 * Hand-rolled SVG rather than a chart library, for the same reason the rest of
 * this app avoids dependencies: the requirements are one line, one area fill,
 * six range buttons and a hover readout, and every charting package that does
 * this also ships several hundred kilobytes of everything else.
 *
 * The line is coloured by the performance of the SELECTED range — green when
 * the range is up, red when it is down — which is the convention every
 * brokerage app trains people on. The colour answering "up since when?" with
 * "since the left edge of what you chose" is exactly what makes the range tabs
 * meaningful.
 */

export type PricePoint = { marketDate: string; close: number };

const RANGES = [
  { key: "1M", days: 22 },
  { key: "3M", days: 66 },
  { key: "6M", days: 130 },
  { key: "1Y", days: 252 },
  { key: "5Y", days: 1260 },
  { key: "Max", days: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const W = 720;
const H = 220;
const PAD = { top: 10, right: 8, bottom: 20, left: 8 };

export function PriceChart({ points }: { points: PricePoint[] }) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [hover, setHover] = useState<number | null>(null);

  const view = useMemo(() => {
    const def = RANGES.find((r) => r.key === range)!;
    const slice =
      def.days === Infinity ? points : points.slice(-def.days);
    if (slice.length < 2) return null;

    const closes = slice.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // A flat line still needs vertical room, or it divides by zero.
    const span = max - min || max * 0.01 || 1;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (slice.length - 1)) * innerW;
    const y = (c: number) => PAD.top + (1 - (c - min) / span) * innerH;

    const line = slice
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`)
      .join("");
    const area =
      line +
      `L${x(slice.length - 1).toFixed(2)},${H - PAD.bottom}` +
      `L${PAD.left},${H - PAD.bottom}Z`;

    const first = slice[0].close;
    const last = slice[slice.length - 1].close;
    const changePct = ((last - first) / first) * 100;

    return { slice, min, max, x, y, line, area, first, last, changePct };
  }, [points, range]);

  if (!view) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Not enough recorded prices for a chart yet.
      </p>
    );
  }

  const up = view.changePct >= 0;
  const stroke = up ? "var(--color-bullish)" : "var(--color-bearish)";
  const hovered = hover !== null ? view.slice[hover] : null;
  const shown = hovered ?? view.slice[view.slice.length - 1];
  const shownChangePct = ((shown.close - view.first) / view.first) * 100;

  return (
    <div>
      {/* Readout: hovering scrubs it; leaving snaps back to the latest. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num text-[24px] font-semibold tracking-tight">
          ${formatPrice(shown.close)}
        </span>
        <span
          className={cn(
            "num text-[14px] font-medium",
            shownChangePct >= 0 ? "text-bullish" : "text-bearish",
          )}
        >
          {shownChangePct >= 0 ? "+" : ""}
          {shownChangePct.toFixed(2)}% <span className="text-muted-foreground font-normal">({range})</span>
        </span>
        <span className="num ml-auto text-[12px] text-muted-foreground">
          {shown.marketDate}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full touch-none select-none"
        role="img"
        aria-label={`Closing price, ${range}: from $${formatPrice(view.first)} to $${formatPrice(view.last)}, ${view.changePct >= 0 ? "up" : "down"} ${Math.abs(view.changePct).toFixed(1)} percent`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const i = Math.round(frac * (view.slice.length - 1));
          setHover(Math.max(0, Math.min(view.slice.length - 1, i)));
        }}
      >
        <path d={view.area} fill={stroke} opacity={0.08} />
        <path d={view.line} fill="none" stroke={stroke} strokeWidth={1.75} />
        {hovered && hover !== null ? (
          <>
            <line
              x1={view.x(hover)}
              x2={view.x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.25}
            />
            <circle
              cx={view.x(hover)}
              cy={view.y(hovered.close)}
              r={3.5}
              fill={stroke}
            />
          </>
        ) : null}
      </svg>

      <div className="mt-1 flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setRange(r.key);
              setHover(null);
            }}
            aria-pressed={range === r.key}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              range === r.key
                ? "bg-surface-raised font-medium text-foreground"
                : "text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {r.key}
          </button>
        ))}
        <span className="num ml-auto text-[11px] text-muted-foreground">
          Low ${formatPrice(view.min)} · High ${formatPrice(view.max)}
        </span>
      </div>
    </div>
  );
}
