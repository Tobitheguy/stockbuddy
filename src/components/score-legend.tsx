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
        The score ranks; it is not a mark out of 100. It multiplies four factors
        that are each below 1 — expected size of the move, the model&apos;s
        confidence, how close the source is to the primary document, and how
        fresh it is — so a genuinely strong signal lands around 30 and anything
        past 45 is rare.
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
    </div>
  );
}
