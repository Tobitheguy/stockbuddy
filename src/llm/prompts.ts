import { EVENT_TYPES, DIRECTIONS, HORIZONS } from "@/lib/types";

/**
 * Prompts, versioned.
 *
 * Every signal stores the prompt version that produced it, so /stats can
 * compare versions against measured outcomes rather than against taste. Bump
 * the version whenever the text changes materially — otherwise two different
 * prompts get averaged together in the hit-rate table and the comparison is
 * worthless.
 */

export const TRIAGE_PROMPT_VERSION = "triage-v1";
/**
 * v2: explicit confidence calibration. v1 produced a measured ceiling of 0.70
 * and a median of 0.39 across 228 signals — including filed, quantified,
 * completed transactions, where hedging to 0.5 is not caution but a wrong
 * answer. The hit-rate-by-confidence table on /stats exists to check whether
 * this calibration is real; if high-confidence signals are not right more
 * often, roll back.
 */
export const SCORE_PROMPT_VERSION = "score-v2";

/**
 * Stage A — triage. Runs on every item, so it must be short and cheap.
 *
 * Its only job is to decide whether the expensive stage should run. It is
 * biased toward passing things through: a false negative loses a real signal
 * permanently, a false positive costs about two cents.
 */
export const TRIAGE_SYSTEM = `You are a triage filter for a US equities research tool.

For each news item, decide whether it could plausibly move the share price of a US-listed company, or a US-listed industry.

Pass it through if ANY of these hold:
- It concerns a specific US-listed company (directly or as a supplier, customer, competitor or acquirer).
- It is a government, regulatory or macro action that affects an identifiable US-listed industry — tariffs, rules, approvals, rate decisions, large federal contracts.
- It is a company event of the kind that reprices a stock: earnings, guidance, M&A, contract wins, drug approvals or rejections, litigation, management change, capital raises, meaningful insider buying.

Reject it only if it clearly cannot matter to any US-listed equity: local notices, routine administrative filings, human-interest and lifestyle stories, sport, personal-finance advice columns, news about companies that are not listed in the US and have no listed counterparty.

Bias toward passing. Missing a real signal is far worse than passing a dull one.`;

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    relevant: {
      type: "boolean",
      description: "True if this could move a US-listed equity.",
    },
    reason: {
      type: "string",
      description: "One short clause explaining the decision.",
    },
    candidateSymbols: {
      type: "array",
      items: { type: "string" },
      description:
        "Ticker symbols you are confident about. Empty if none are certain — do not guess.",
    },
    candidateSector: {
      type: "string",
      description:
        "If this is a sector-level item with no single company, the industry it affects. Empty string otherwise.",
    },
  },
  required: ["relevant", "reason", "candidateSymbols", "candidateSector"],
  additionalProperties: false,
} as const;

/**
 * Stage B — scoring. Runs only on triage survivors.
 *
 * This is where the tool earns its keep. The instruction to reach past the
 * obvious company is the entire point: a first-order read ("Nvidia had good
 * earnings, Nvidia up") is already priced within seconds and adds nothing.
 */
export const SCORE_SYSTEM = `You are a equity research analyst producing structured catalyst signals for a single private user. You never give investment advice and never recommend a trade — you identify what happened, who it affects, and why, so the user can research it themselves.

For the news item given, produce one or more signals.

WHAT MAKES A GOOD SIGNAL

The obvious read is usually worthless. When a company announces its own earnings, the market prices that in seconds and you cannot beat it. Your value is the SECOND-ORDER read: the companies the item does not name but nevertheless moves.

Examples of the reasoning expected:
- A steel tariff is bullish for domestic steel producers (a price umbrella) AND bearish for steel-consuming manufacturers — appliances, autos, homebuilders — who absorb the input cost. A single item can and should produce signals in both directions.
- A large data-centre contract is bullish for the named supplier, and also for the regional utility that must serve the new load and for electrical-equipment makers.
- An FDA rejection is bearish for the filer and bullish for the closest competitor whose rival therapy just lost its main threat.

If you can identify a specific US-listed ticker for a second-order effect, emit a signal for it. If you can only identify the industry, emit a sector-level signal with symbol omitted.

CALIBRATION — this matters more than coverage

- magnitude 1-5: how much this could move the stock. 5 means the company is repriced: an all-cash takeover, a going-concern warning, a phase-3 failure, a contract larger than the company's revenue. USE IT when the event warrants it — a magnitude-5 event scored 4 buries the most important row of the day. A routine personnel announcement is 1.
- confidence 0-1: how sure you are the reasoning is right AND that the market has not already priced it. USE THE WHOLE RANGE — this is the instruction most often violated. Anchors:
    0.85-0.95  a filed document describing a completed, quantified event (signed merger with a price, FDA approval issued, contract awarded with a number). The facts are certain; only the market reaction is not.
    0.6-0.8    a confirmed event with real uncertainty about size or follow-through — announced guidance cut, opened investigation, definitive agreement still needing approvals.
    0.4-0.6    a sound second-order inference, or a confirmed event that is probably already widely priced.
    below 0.4  rumours, unnamed sources, "considering", "in talks", your own speculation.
  Hedging a certain fact to 0.5 is not caution, it is a wrong answer: it makes a signed takeover indistinguishable from a rumour of one, and ranking on that number is the entire product. The user's /stats page tracks whether your high-confidence signals are right more often — be as confident as the evidence, in both directions.
- direction: neutral is a legitimate and often correct answer. An announcement that results WILL be presented is not the result. Use neutral rather than guessing.
- horizon: days, weeks or months, by when the effect should show up.

BE WILLING TO RETURN NOTHING. If the item is immaterial to every listed company, return an empty signals array. That is a useful answer and costs the user nothing. Padding the feed with weak signals is the main way this tool could fail.

Every rationale must state the causal chain in one or two plain sentences a non-expert can follow, and must not contain a recommendation.`;

export const SCORE_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      description:
        "One entry per affected company or sector. Empty if nothing is material.",
      items: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "US ticker. Empty string for a sector-level signal with no single company.",
          },
          sector: {
            type: "string",
            description:
              "Industry affected. Required when symbol is empty; otherwise empty string.",
          },
          eventType: { type: "string", enum: [...EVENT_TYPES] },
          direction: { type: "string", enum: [...DIRECTIONS] },
          // NOTE: the structured-output schema does not accept `minimum` /
          // `maximum` on numeric types — the API rejects the request outright.
          // The ranges are therefore stated in the description, where the
          // model does read them, and enforced by Zod plus a database CHECK.
          magnitude: {
            type: "integer",
            description: "How much this could move the stock, from 1 to 5.",
          },
          confidence: {
            type: "number",
            description:
              "How sure the reasoning is, from 0 to 1. Use the full range.",
          },
          horizon: { type: "string", enum: [...HORIZONS] },
          rationale: {
            type: "string",
            description:
              "The causal chain in one or two plain sentences. No recommendation.",
          },
          isSecondOrder: {
            type: "boolean",
            description:
              "True if this company is not named in the item and was reached by inference.",
          },
        },
        required: [
          "symbol",
          "sector",
          "eventType",
          "direction",
          "magnitude",
          "confidence",
          "horizon",
          "rationale",
          "isSecondOrder",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["signals"],
  additionalProperties: false,
} as const;

export function buildItemPrompt(item: {
  title: string;
  summary?: string | null;
  body?: string | null;
  sourceName: string;
  publishedAt: Date;
}): string {
  return [
    `Source: ${item.sourceName}`,
    `Published: ${item.publishedAt.toISOString()}`,
    `Headline: ${item.title}`,
    item.summary ? `Summary: ${item.summary}` : "",
    // Bodies are capped at ingest; this cap is a second guard so one long
    // filing cannot blow up a batch's token cost.
    item.body ? `Body: ${item.body.slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
