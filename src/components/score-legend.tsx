import { SCORE_BANDS } from "@/scoring";

/**
 * What the score means, on the page, once.
 *
 * Without this the number is read as a percentage, and the top of a normal day
 * — a genuinely strong signal in the low 30s — looks like a failing grade. The
 * scale is a ranking, not a mark out of 100, and there is no way for a reader
 * to know that from the number alone.
 *
 * Deliberately not collapsible. It is two lines, it is the key to every other
 * number on the page, and a hidden legend is a legend nobody reads.
 */
export function ScoreLegend() {
  return (
    <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
      <p className="text-[12px] text-muted-foreground">
        The score combines expected size of the move, the model&apos;s
        confidence, source quality and freshness. Around 50 is the top of a
        normal day; past 62 means a large, well-sourced, fresh catalyst — the
        thing this tool exists to catch. It ranks research candidates; it is
        never a recommendation.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {SCORE_BANDS.map((b) => (
          <li key={b.label} className="flex items-baseline gap-1.5 text-[11px]">
            <span className="font-medium text-foreground">{b.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {b.min}+
            </span>
          </li>
        ))}
      </ul>
      {/* The score/direction split confused the tool's own user into reading
          "Strong · Bearish" as a buy signal. Score = how important; direction
          = which way. It has to be said here, where both are first seen. */}
      <p className="mt-2 border-t border-border pt-2 text-[12px] text-muted-foreground">
        <strong className="text-foreground">Score ≠ recommendation.</strong>{" "}
        Score says how important; direction says which way.{" "}
        <span className="text-bullish">▲ Bullish</span> reads positive for the
        share price — a candidate to research.{" "}
        <span className="text-bearish">▼ Bearish</span> reads negative — a
        warning, not a buying opportunity. “Strong · Bearish” means strong
        evidence the stock may fall.
      </p>
    </div>
  );
}
