/**
 * Signal scoring.
 *
 *   score = magnitude × confidence × sourceWeight × recencyDecay × 100
 *
 * Each factor is 0-1 after normalisation, so the product lands in 0-100 and
 * the database CHECK constraint holds by construction rather than by clamping.
 *
 * The whole ranking of the product depends on this function, so it is pure,
 * dependency-free and tested. It never reads the clock itself — `now` is
 * always passed in, or the same signal would score differently depending on
 * when a page happened to render.
 */

import type { Direction, EventType, Horizon } from "@/lib/types";

export type ScoreInput = {
  /** 1-5, how big the move could be. */
  magnitude: number;
  /** 0-1, how sure the scorer is that the read is right. */
  confidence: number;
  /** 0-1, how close the source is to the primary document. */
  sourceWeight: number;
  publishedAt: Date;
  now: Date;
  /**
   * How long the effect is expected to last. A macro read that plays out over
   * months should not decay at the same rate as an earnings surprise.
   */
  horizon?: Horizon;
};

/**
 * Half-life of a signal's score, in hours, by horizon.
 *
 * A "days" signal loses half its score in 18 hours — roughly one trading
 * session — because a short-horizon catalyst that you read about tomorrow is
 * mostly priced. A "months" signal decays over weeks, because a tariff or a
 * capacity decision is still actionable a fortnight later.
 */
const HALF_LIFE_HOURS: Record<Horizon, number> = {
  days: 18,
  weeks: 96, // 4 days
  months: 504, // 3 weeks
};

const DEFAULT_HALF_LIFE_HOURS = 36;

/**
 * Exponential decay on age.
 *
 * Exponential rather than linear because relevance really does fall off a
 * cliff early and then flatten: the difference between a 1-hour-old and a
 * 6-hour-old filing matters enormously, while the difference between 20 days
 * and 25 days barely matters at all. A linear decay gets both backwards.
 *
 * Returns 1 at age zero and approaches 0, never reaching it — an old signal
 * ranks last, but never becomes invisible.
 */
export function recencyDecay(
  publishedAt: Date,
  now: Date,
  horizon?: Horizon,
): number {
  const halfLife = horizon
    ? HALF_LIFE_HOURS[horizon]
    : DEFAULT_HALF_LIFE_HOURS;

  const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;

  // Feeds do publish timestamps slightly in the future. Treat those as brand
  // new rather than letting them score above 1 and outrank everything.
  if (ageHours <= 0) return 1;

  return Math.pow(0.5, ageHours / halfLife);
}

/** Magnitude 1-5 mapped onto 0-1. */
function normalizeMagnitude(magnitude: number): number {
  const clamped = Math.min(5, Math.max(1, magnitude));
  // 1 -> 0.2, 5 -> 1.0. A magnitude-1 signal keeps a fifth of its weight
  // rather than none: small but real is still worth ranking above noise.
  return clamped / 5;
}

export function computeScore(input: ScoreInput): number {
  const magnitude = normalizeMagnitude(input.magnitude);
  const confidence = Math.min(1, Math.max(0, input.confidence));
  const weight = Math.min(1, Math.max(0, input.sourceWeight));
  const decay = recencyDecay(input.publishedAt, input.now, input.horizon);

  const raw = magnitude * confidence * weight * decay * 100;

  // Two decimals matches the numeric(5,2) column exactly, so what is stored is
  // what was computed — no silent rounding drift between the two.
  return Math.round(raw * 100) / 100;
}

/**
 * Baseline scoring for SCORING_MODE=off, where no model has read the item.
 *
 * This exists so the free mode still produces a usefully ranked feed. It is
 * deliberately conservative and deliberately honest: direction is always
 * neutral, because nothing has actually judged the direction, and confidence
 * is capped low so a rule-scored row can never outrank a model-scored one of
 * equal magnitude.
 */
export const RULE_BASED_CONFIDENCE = 0.35;

/**
 * Magnitude guessed from the form type or source alone.
 *
 * This is not a judgement about the content — nothing has read the content. It
 * is a prior: an 8-K is material by definition of what an 8-K is for, while a
 * general news headline usually is not.
 */
const FORM_PRIOR: Array<{ match: RegExp; magnitude: number; event: EventType }> = [
  { match: /SC TO-T/i, magnitude: 5, event: "M&A" },
  { match: /SC 13D/i, magnitude: 4, event: "capital_raise" },
  { match: /NT 10-[KQ]/i, magnitude: 4, event: "legal" },
  { match: /\b425\b/i, magnitude: 4, event: "M&A" },
  { match: /8-K/i, magnitude: 3, event: "other" },
  { match: /10-K/i, magnitude: 3, event: "earnings" },
  { match: /10-Q/i, magnitude: 3, event: "earnings" },
  { match: /6-K/i, magnitude: 3, event: "other" },
  { match: /S-1/i, magnitude: 3, event: "capital_raise" },
  { match: /SC 13G/i, magnitude: 2, event: "capital_raise" },
  { match: /Form 4/i, magnitude: 2, event: "insider_trade" },
  { match: /USASpending/i, magnitude: 4, event: "contract_win" },
  { match: /ClinicalTrials/i, magnitude: 4, event: "regulatory_policy" },
  { match: /openFDA/i, magnitude: 4, event: "regulatory_policy" },
  { match: /FDA -/i, magnitude: 4, event: "regulatory_policy" },
  { match: /FTC -/i, magnitude: 4, event: "regulatory_policy" },
  { match: /USTR/i, magnitude: 3, event: "regulatory_policy" },
  { match: /Federal Register/i, magnitude: 2, event: "regulatory_policy" },
  { match: /Federal Reserve/i, magnitude: 3, event: "macro" },
  { match: /GlobeNewswire|Business Wire|PR Newswire/i, magnitude: 3, event: "other" },
];

export function rulePrior(sourceName: string): {
  magnitude: number;
  eventType: EventType;
  direction: Direction;
} {
  for (const rule of FORM_PRIOR) {
    if (rule.match.test(sourceName)) {
      return {
        magnitude: rule.magnitude,
        eventType: rule.event,
        // Never guessed. Nothing has read the content, so claiming a direction
        // would be inventing a judgement, and a wrong direction is worse than
        // no direction — it would poison the /stats hit rate with noise.
        direction: "neutral",
      };
    }
  }
  return { magnitude: 2, eventType: "other", direction: "neutral" };
}
