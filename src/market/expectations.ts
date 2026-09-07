import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * What moves look like — measured, never forecast.
 *
 * The user asked where a stock "could go" after news. That question has no
 * honest answer as a number, but it has two honest answers as distributions,
 * and both are computed from data this tool already stores:
 *
 *   typicalMove()  How far this specific stock actually travels over 5 and 20
 *                  trading days, from its own last year of closes. Answers
 *                  "is a 4% move big for THIS stock?" — which is the question
 *                  behind "how far could it go", and is a fact, not a guess.
 *
 *   comparables()  What happened after past signals of the same event type and
 *                  direction. Answers "when this tool called a bullish merger
 *                  before, what followed?" — a track record, which may equally
 *                  show the tool is wrong about mergers.
 *
 * Neither is a prediction and the UI must never present them as one. A base
 * rate says what usually happened; it cannot say what happens next.
 */

export type TypicalMove = {
  /** Trading-day span these figures describe. */
  days: number;
  /** Half of all moves were smaller than this, in percent (absolute). */
  medianAbsPct: number;
  /** Nine in ten were smaller than this. */
  p90AbsPct: number;
  bestPct: number;
  worstPct: number;
  samples: number;
};

/**
 * Distribution of overlapping N-trading-day returns over the past year.
 *
 * Overlapping windows are used deliberately: with ~250 closes, non-overlapping
 * 20-day windows would give 12 samples, which is not a distribution. Overlap
 * inflates the sample count without adding independent information, so this
 * is presented as "how big are moves" and never used for a significance claim.
 */
export function typicalMove(
  closes: Array<{ close: number }>,
  days: number,
): TypicalMove | null {
  const year = closes.slice(-252);
  if (year.length < days + 30) return null;

  const moves: number[] = [];
  for (let i = days; i < year.length; i++) {
    const from = year[i - days].close;
    if (from > 0) moves.push((year[i].close / from - 1) * 100);
  }
  if (moves.length < 30) return null;

  const abs = moves.map(Math.abs).sort((a, b) => a - b);
  const at = (q: number) => abs[Math.min(abs.length - 1, Math.floor(q * abs.length))];

  return {
    days,
    medianAbsPct: at(0.5),
    p90AbsPct: at(0.9),
    bestPct: Math.max(...moves),
    worstPct: Math.min(...moves),
    samples: moves.length,
  };
}

export type Comparables = {
  eventType: string;
  direction: string;
  measured: number;
  medianReturn5d: number | null;
  bestReturn5d: number | null;
  worstReturn5d: number | null;
  hitRate: number | null;
};

/**
 * Below this the numbers are anecdotes. The UI must show the count and refuse
 * to summarise under it — a median of three observations reads as a finding
 * and is noise.
 */
export const MIN_COMPARABLES = 8;

/** Realised outcomes of past signals sharing this event type and direction. */
export async function comparables(
  eventType: string,
  direction: string,
): Promise<Comparables> {
  const rows = (await db().execute(sql`
    select
      count(o.return_5d)                                    as measured,
      percentile_cont(0.5) within group (order by o.return_5d) as median_5d,
      max(o.return_5d)                                      as best_5d,
      min(o.return_5d)                                      as worst_5d,
      avg(case when o.direction_correct_5d then 1.0 else 0.0 end)
        filter (where o.direction_correct_5d is not null)   as hit_rate
    from signals sg
    join signal_outcomes o on o.signal_id = sg.id
    where sg.event_type = ${eventType}::event_type
      and sg.direction = ${direction}::direction
      and sg.model <> 'rules'
      and o.return_5d is not null`)) as unknown as
    | Array<Record<string, unknown>>
    | { rows: Array<Record<string, unknown>> };

  const r = (Array.isArray(rows) ? rows[0] : rows.rows?.[0]) ?? {};
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    eventType,
    direction,
    measured: Number(r.measured ?? 0),
    medianReturn5d: num(r.median_5d),
    bestReturn5d: num(r.best_5d),
    worstReturn5d: num(r.worst_5d),
    hitRate: num(r.hit_rate),
  };
}
