import { cn } from "@/lib/utils";

/**
 * Price sparkline, hand-rolled SVG.
 *
 * No charting library: this draws one polyline. Pulling in a charting
 * dependency for that would add bundle weight and a client component to a
 * page that is otherwise fully server-rendered.
 */
export function Sparkline({
  points,
  className,
  height = 72,
}: {
  points: Array<{ marketDate: string; close: number }>;
  className?: string;
  height?: number;
}) {
  // Two points is the minimum that can express a direction. One point is a
  // dot, and drawing it would imply a trend that does not exist.
  if (points.length < 2) return null;

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  // A flat line would otherwise divide by zero and collapse to NaN.
  const span = max - min || Math.max(max * 0.01, 0.01);

  const W = 100; // viewBox units; the SVG scales to its container
  const H = 100;
  const PAD = 6;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - PAD - ((p.close - min) / span) * (H - PAD * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const first = closes[0];
  const last = closes[closes.length - 1];
  const up = last >= first;
  const stroke = up ? "var(--bullish)" : "var(--bearish)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={`Price from ${points[0].marketDate} to ${
        points[points.length - 1].marketDate
      }: ${first.toFixed(2)} to ${last.toFixed(2)}, ${
        up ? "up" : "down"
      } over ${points.length} trading days`}
    >
      {/* Fill under the line, purely to give the eye a shape to read. */}
      <polygon
        points={`0,${H} ${coords.join(" ")} ${W},${H}`}
        fill={stroke}
        opacity="0.08"
      />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
