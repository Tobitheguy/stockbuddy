import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/db/client";
import { llmUsage } from "@/db/schema";
import { DIRECTIONS, EVENT_TYPES, HORIZONS } from "@/lib/types";
import {
  buildItemPrompt,
  SCORE_SCHEMA,
  SCORE_SYSTEM,
  TRIAGE_SCHEMA,
  TRIAGE_SYSTEM,
} from "./prompts";

/**
 * Claude calls, with cost accounting.
 *
 * Every call records its token usage and computed cost. That is not
 * bookkeeping for its own sake: the daily budget guard reads it, and /stats
 * shows what the tool actually cost against what it actually predicted.
 */

export const TRIAGE_MODEL = "claude-haiku-4-5";
export const SCORE_MODEL = "claude-opus-5";

/** USD per million tokens. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

export function costUsd(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): number {
  const p = PRICING[model];
  if (!p) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  // Cached reads bill at roughly 10% of input, writes at 125%. Ignoring these
  // would misreport cost by a large factor once prompt caching is doing its
  // job, which is exactly when the number matters.
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * p.input +
      output * p.output +
      cacheRead * p.input * 0.1 +
      cacheWrite * p.input * 1.25) /
    1_000_000
  );
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Either set it, or leave SCORING_MODE=off " +
          "to run the free rule-based pipeline.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

async function recordUsage(args: {
  runId: number | null;
  stage: "triage" | "score";
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}): Promise<number> {
  const cost = costUsd(args.model, args.usage);
  await db()
    .insert(llmUsage)
    .values({
      runId: args.runId,
      stage: args.stage,
      model: args.model,
      inputTokens: args.usage.input_tokens ?? 0,
      outputTokens: args.usage.output_tokens ?? 0,
      cacheReadTokens: args.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: args.usage.cache_creation_input_tokens ?? 0,
      costUsd: cost.toFixed(6),
    });
  return cost;
}

/** Pull the first text block out of a response. */
function firstText(content: Anthropic.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Stage A — triage
// ---------------------------------------------------------------------------

const TriageResult = z.object({
  relevant: z.boolean(),
  reason: z.string(),
  candidateSymbols: z.array(z.string()),
  candidateSector: z.string(),
});
export type TriageResult = z.infer<typeof TriageResult>;

export async function triage(
  item: Parameters<typeof buildItemPrompt>[0],
  runId: number | null,
): Promise<{ result: TriageResult; cost: number }> {
  const response = await anthropic().messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: TRIAGE_SYSTEM,
        // The system prompt is identical on every call in a batch, so caching
        // it turns the dominant token cost of this stage into a rounding error.
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
    messages: [{ role: "user", content: buildItemPrompt(item) }],
  });

  const cost = await recordUsage({
    runId,
    stage: "triage",
    model: TRIAGE_MODEL,
    usage: response.usage,
  });

  // A structured-output response is guaranteed to parse, but a refusal or a
  // max_tokens truncation is not. Treat anything unparseable as "pass it
  // through" rather than silently dropping a possible signal.
  try {
    return { result: TriageResult.parse(JSON.parse(firstText(response.content))), cost };
  } catch {
    return {
      result: {
        relevant: true,
        reason: "triage response unparseable; passed through to be safe",
        candidateSymbols: [],
        candidateSector: "",
      },
      cost,
    };
  }
}

// ---------------------------------------------------------------------------
// Stage B — scoring
// ---------------------------------------------------------------------------

const ScoredSignal = z.object({
  symbol: z.string(),
  sector: z.string(),
  eventType: z.enum(EVENT_TYPES),
  direction: z.enum(DIRECTIONS),
  // Clamped rather than rejected. A magnitude of 6 is a calibration miss, not
  // a malformed response, and throwing away a good rationale over it would
  // waste the call that produced it. The database CHECK is the final guard.
  magnitude: z
    .number()
    .transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
  confidence: z.number().transform((n) => Math.min(1, Math.max(0, n))),
  horizon: z.enum(HORIZONS),
  rationale: z.string().min(1),
  isSecondOrder: z.boolean(),
});
const ScoreResult = z.object({ signals: z.array(ScoredSignal) });

export type ScoredSignal = z.infer<typeof ScoredSignal>;

export async function scoreItem(
  item: Parameters<typeof buildItemPrompt>[0],
  runId: number | null,
  model: string = SCORE_MODEL,
): Promise<{ signals: ScoredSignal[]; cost: number; model: string }> {
  const call = () =>
    anthropic().messages.create({
      model,
      max_tokens: 4096,
      system: [
        { type: "text", text: SCORE_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      output_config: { format: { type: "json_schema", schema: SCORE_SCHEMA } },
      messages: [{ role: "user", content: buildItemPrompt(item) }],
    });

  let response = await call();
  let cost = await recordUsage({ runId, stage: "score", model, usage: response.usage });

  let parsed = ScoreResult.safeParse(safeJson(firstText(response.content)));

  if (!parsed.success) {
    // One retry, as specified. A single malformed response is usually a
    // truncation or a transient hiccup; two in a row means give up rather
    // than burn budget in a loop.
    response = await call();
    cost += await recordUsage({ runId, stage: "score", model, usage: response.usage });
    parsed = ScoreResult.safeParse(safeJson(firstText(response.content)));
  }

  if (!parsed.success) return { signals: [], cost, model };

  // Drop rows that name neither a company nor a sector — the database CHECK
  // would reject them anyway, and failing here gives a clearer error.
  const signals = parsed.data.signals.filter(
    (s) => s.symbol.trim() !== "" || s.sector.trim() !== "",
  );
  return { signals, cost, model };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
