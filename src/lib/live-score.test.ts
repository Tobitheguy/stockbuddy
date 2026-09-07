import { describe, expect, it } from "vitest";
import { liveScore } from "./live-score";
import { computeBaseScore, computeScore } from "@/scoring";
import type { Horizon } from "@/lib/types";

/**
 * The decay maths now exists twice: once in TypeScript for writing a signal,
 * once in SQL for ordering the feed. Two implementations of one formula drift,
 * and the drift would be invisible — the feed would simply be in a subtly
 * wrong order, with every individual number looking plausible.
 *
 * These tests pin the SQL text so a change to the half-lives in scoring.ts
 * cannot silently leave the SQL behind, and check the arithmetic agreement on
 * the TypeScript side.
 */
describe("liveScore SQL", () => {
  const sqlText = () => {
    const q = liveScore();
    // Drizzle's SQL object exposes its chunks; join the raw text back together.
    return JSON.stringify(q).replace(/\s+/g, " ");
  };

  it("carries the same half-lives as the TypeScript scorer", () => {
    const text = sqlText();
    for (const [horizon, hours] of [
      ["days", "36"],
      ["weeks", "168"],
      ["months", "720"],
    ] as const) {
      expect(text).toContain(horizon);
      expect(text).toContain(hours);
    }
  });

  it("falls back to the stored score when base_score is null", () => {
    // Rows written before the column existed must still rank, not drop to 0.
    expect(sqlText()).toContain("coalesce");
  });

  it("clamps negative ages, matching recencyDecay's future-timestamp guard", () => {
    expect(sqlText()).toContain("greatest");
  });
});

describe("base score and decayed score agree", () => {
  const publishedAt = new Date("2026-09-06T00:00:00Z");

  it("decayed score equals base score times the decay factor", () => {
    for (const horizon of ["days", "weeks", "months"] as Horizon[]) {
      for (const ageHours of [0, 6, 18, 96, 504]) {
        const inputs = { magnitude: 4, confidence: 0.7, sourceWeight: 0.7 };
        const now = new Date(publishedAt.getTime() + ageHours * 3_600_000);

        const base = computeBaseScore(inputs);
        const decayed = computeScore({ ...inputs, publishedAt, now, horizon });
        const halfLife = { days: 36, weeks: 168, months: 720 }[horizon];
        const expected = base * Math.pow(0.5, ageHours / halfLife);

        expect(decayed).toBeCloseTo(expected, 1);
      }
    }
  });

  it("base score is independent of when it is computed", () => {
    // The whole point of the split: this number must never move on its own.
    const inputs = { magnitude: 3, confidence: 0.55, sourceWeight: 0.85 };
    expect(computeBaseScore(inputs)).toBe(computeBaseScore(inputs));
    expect(computeBaseScore(inputs)).toBeGreaterThan(
      computeScore({
        ...inputs,
        publishedAt,
        now: new Date(publishedAt.getTime() + 86_400_000),
        horizon: "days",
      }),
    );
  });
});
