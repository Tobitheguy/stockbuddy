/**
 * Signal scoring.
 *
 *   score = magnitude × confidence × sourceWeight × recencyDecay × 100
 *
 * Each factor is 0-1 after normalisation, so the product lands in 0-100 and
 * the database CHECK constraint holds by construction rather than by clamping.
 *
 * READ THE SCALE CORRECTLY. Four factors below 1 multiply into a small number,
 * so 100 is not a grade a real signal approaches — it needs magnitude 5 AND
 * near-total confidence AND a primary source AND to be minutes old, all at
 * once. Measured on live data, an ordinary strong signal lands in the 30s and
 * anything past 50 is rare. The number ranks; it does not grade. `SCORE_BANDS`
 * below is the interpretation, and the UI shows it so 30 is not misread as a
 * failing mark.
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
 * CALIBRATED FOR A TOOL CHECKED ONCE A DAY, which is what changed these
 * numbers. The first version used 18 hours for "days", on the reasoning that a
 * short-horizon catalyst read about tomorrow is already priced. That is true
 * for a trader watching a screen and wrong for this product: at 18 hours a
 * signal keeps 40% overnight and 6% after three days, so genuinely large
 * events were invisible by the time anyone looked at them. Measured on live
 * data, a filing that scored 85 fresh was showing 17 — the tool had found the
 * thing and then hidden it.
 *
 * 36 hours keeps 63% overnight, which is the actual requirement: a catalyst
 * found while you slept must still be at the top when you wake up. Longer
 * horizons scale with it — a tariff or a capacity decision is still worth
 * reading a fortnight later, and a merger process runs for months.
 */
const HALF_LIFE_HOURS: Record<Horizon, number> = {
  days: 36, // overnight, plus a margin
  weeks: 168, // one week
  months: 720, // one month
};

const DEFAULT_HALF_LIFE_HOURS = 72;

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

/**
 * Source weight, compressed onto 0.65-1.0 instead of applied raw.
 *
 * Applying it raw punished the same thing twice. The scoring prompt already
 * instructs the model to lower its confidence for rumours, unnamed sources and
 * anything likely to be priced in — so an aggregator's story arrives with a
 * confidence that has *already* absorbed the reliability question. Multiplying
 * by 0.70 on top of that charged it a second time, and the effect was not
 * marginal: 187 of 228 model signals came from one 0.70 source, so almost the
 * entire feed was being scaled down by 30% for a reason already counted.
 *
 * Compression keeps the ordering — a primary filing still outranks a wire
 * summary, all else equal — while making the penalty a modifier rather than
 * the dominant term. 0.5 -> 0.83, 0.7 -> 0.90, 0.9 -> 0.97, 1.0 -> 1.0.
 *
 * The floor is 0.65 and not 0: a source we would not trust at all does not
 * belong in the sources table, and one that is there should not be able to
 * annihilate a genuine catalyst on provenance alone.
 */
const SOURCE_WEIGHT_FLOOR = 0.65;

function normalizeSourceWeight(weight: number): number {
  const clamped = Math.min(1, Math.max(0, weight));
  return SOURCE_WEIGHT_FLOOR + (1 - SOURCE_WEIGHT_FLOOR) * clamped;
}

/**
 * The time-invariant part: magnitude × confidence × source weight × 100.
 *
 * Stored, and multiplied by a freshly computed decay whenever the feed is
 * ordered or rendered. Splitting it out is what keeps the ranking honest a
 * week later — the alternative is a stored number that was right on the day it
 * was written and drifts silently from then on.
 */
export function computeBaseScore(
  input: Pick<ScoreInput, "magnitude" | "confidence" | "sourceWeight">,
): number {
  const magnitude = normalizeMagnitude(input.magnitude);
  const confidence = Math.min(1, Math.max(0, input.confidence));
  const weight = normalizeSourceWeight(input.sourceWeight);
  return round2(magnitude * confidence * weight * 100);
}

export function computeScore(input: ScoreInput): number {
  const decay = recencyDecay(input.publishedAt, input.now, input.horizon);
  return round2(computeBaseScore(input) * decay);
}

/** Two decimals, matching numeric(5,2) exactly — no drift between the two. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The DISPLAYED score: a gamma stretch of the raw product.
 *
 *   display = 100 × (raw / 100)^0.6
 *
 * The raw product of four sub-1 factors is mathematically honest and humanly
 * unreadable: the strongest signal of a normal day lands near 30, which every
 * reader parses as a failing grade — the user's words were "I want high scores
 * if there is a real market opportunity", and they are right that a scale
 * nobody can read is a defect. The stretch is strictly monotonic, so the
 * RANKING is exactly the raw ranking — nothing moves up or down the feed, no
 * signal gains on another — but the mid-range opens up: raw 30 shows as 49,
 * raw 45 as 62, raw 10 as 25. Storage and /stats keep the raw value; only the
 * rendering layer applies this.
 *
 * The exponent is calibration, not physics. 0.6 was chosen so the measured
 * "top of a normal day" reads as ~50 and the genuinely rare reads as 60+; if
 * the source mix changes materially, re-derive it from the distribution.
 */
const DISPLAY_GAMMA = 0.6;

export function displayScore(raw: number): number {
  const clamped = Math.min(100, Math.max(0, raw));
  return Math.round(100 * Math.pow(clamped / 100, DISPLAY_GAMMA));
}

/**
 * What a displayed score means, in words. Thresholds are displayScore() images
 * of measured raw landmarks (raw 45 → 62, raw 30 → 49, raw 18 → 36, raw 8 →
 * 22) — they describe the current distribution, not a law.
 */
export const SCORE_BANDS = [
  {
    min: 62,
    label: "Rare",
    blurb:
      "Large expected move, high confidence, primary source, fresh. A handful per month.",
  },
  {
    min: 49,
    label: "Strong",
    blurb: "Top of a normal day. Worth opening and reading the filing behind it.",
  },
  {
    min: 36,
    label: "Notable",
    blurb: "A real read, but either second-order, less certain, or not fresh.",
  },
  {
    min: 22,
    label: "Background",
    blurb: "Context. Mostly worth skimming rather than acting on.",
  },
  {
    min: 0,
    label: "Noise",
    blurb: "Low expected impact or low confidence. Kept for the record.",
  },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number];

/** Takes a DISPLAYED score — pass raw values through displayScore() first. */
export function scoreBand(displayed: number): ScoreBand {
  // Ordered high to low, so the first match is the tightest one.
  return SCORE_BANDS.find((b) => displayed >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
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
