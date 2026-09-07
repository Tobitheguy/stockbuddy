import { describe, expect, it } from "vitest";
import { costUsd, SCORE_MODEL, TRIAGE_MODEL } from "./client";

/**
 * Cost accounting drives the daily budget guard. If this is wrong the guard
 * either never fires — and the bill runs — or fires immediately and the
 * pipeline silently degrades to rules. Both failures are quiet, so the maths
 * is tested directly.
 */
describe("costUsd", () => {
  it("prices Haiku triage at the published rate", () => {
    // 1M input @ $1 + 1M output @ $5
    expect(
      costUsd(TRIAGE_MODEL, { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ).toBeCloseTo(6, 6);
  });

  it("prices Opus scoring at the published rate", () => {
    expect(
      costUsd(SCORE_MODEL, { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ).toBeCloseTo(30, 6);
  });

  it("bills cached reads at a tenth of input", () => {
    // Ignoring this would overstate cost several-fold once prompt caching is
    // working — which is precisely when the number matters.
    const cached = costUsd(TRIAGE_MODEL, {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cached).toBeCloseTo(0.1, 6);
  });

  it("bills cache writes at a premium over plain input", () => {
    const write = costUsd(TRIAGE_MODEL, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(write).toBeCloseTo(1.25, 6);
    expect(write).toBeGreaterThan(
      costUsd(TRIAGE_MODEL, { input_tokens: 1_000_000, output_tokens: 0 }),
    );
  });

  it("treats missing usage fields as zero rather than NaN", () => {
    // A NaN here would poison the running total and disable the budget guard
    // entirely, because NaN >= budget is false.
    const c = costUsd(TRIAGE_MODEL, {});
    expect(c).toBe(0);
    expect(Number.isNaN(c)).toBe(false);
  });

  it("returns 0 for a model it has no price for, never NaN", () => {
    // An unknown model must not silently break the guard. Zero is wrong but
    // safe and visible; NaN is wrong and invisible.
    const c = costUsd("some-future-model", {
      input_tokens: 500_000,
      output_tokens: 500_000,
    });
    expect(c).toBe(0);
  });

  it("costs a realistic triage call a fraction of a cent", () => {
    // ~250 uncached input tokens, cached system prompt, ~40 output.
    const c = costUsd(TRIAGE_MODEL, {
      input_tokens: 250,
      output_tokens: 40,
      cache_read_input_tokens: 400,
    });
    expect(c).toBeLessThan(0.001);
    expect(c).toBeGreaterThan(0);
  });

  it("costs a realistic Opus scoring call about two cents", () => {
    const c = costUsd(SCORE_MODEL, {
      input_tokens: 1200,
      output_tokens: 500,
      cache_read_input_tokens: 600,
    });
    expect(c).toBeGreaterThan(0.01);
    expect(c).toBeLessThan(0.03);
  });
});
