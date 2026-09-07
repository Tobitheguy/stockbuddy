import { describe, expect, it } from "vitest";
import { computeScore, recencyDecay, rulePrior } from "./scoring";

const NOW = new Date("2026-09-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("recencyDecay", () => {
  it("is 1 for something published right now", () => {
    expect(recencyDecay(NOW, NOW, "days")).toBe(1);
  });

  it("halves at exactly one half-life", () => {
    // "days" half-life is 18 hours, roughly one trading session.
    expect(recencyDecay(hoursAgo(18), NOW, "days")).toBeCloseTo(0.5, 6);
    expect(recencyDecay(hoursAgo(36), NOW, "days")).toBeCloseTo(0.25, 6);
  });

  it("decays a long-horizon signal far more slowly than a short one", () => {
    // The point of horizon-aware decay: a tariff is still actionable a week
    // later; an earnings surprise is not.
    const week = 24 * 7;
    const short = recencyDecay(hoursAgo(week), NOW, "days");
    const long = recencyDecay(hoursAgo(week), NOW, "months");
    expect(long).toBeGreaterThan(short * 20);
  });

  it("never reaches zero, so an old signal ranks last but stays visible", () => {
    const ancient = recencyDecay(hoursAgo(24 * 365), NOW, "days");
    expect(ancient).toBeGreaterThan(0);
    expect(ancient).toBeLessThan(0.0001);
  });

  it("is monotonically decreasing", () => {
    const ages = [0, 1, 6, 12, 24, 48, 168];
    const values = ages.map((h) => recencyDecay(hoursAgo(h), NOW, "weeks"));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
  });

  it("clamps a future timestamp to 1 instead of scoring above it", () => {
    // Feeds do publish slightly-future timestamps. Without the clamp those
    // would score >1 and permanently outrank everything real.
    const future = new Date(NOW.getTime() + 3_600_000);
    expect(recencyDecay(future, NOW, "days")).toBe(1);
  });
});

describe("computeScore", () => {
  const base = {
    magnitude: 5,
    confidence: 1,
    sourceWeight: 1,
    publishedAt: NOW,
    now: NOW,
    horizon: "days" as const,
  };

  it("gives a perfect fresh signal 100", () => {
    expect(computeScore(base)).toBe(100);
  });

  it("stays inside 0-100 so the database CHECK holds by construction", () => {
    const extremes = [
      { ...base, magnitude: 99, confidence: 5, sourceWeight: 9 },
      { ...base, magnitude: -3, confidence: -1, sourceWeight: -1 },
      { ...base, publishedAt: hoursAgo(100_000) },
    ];
    for (const input of extremes) {
      const s = computeScore(input);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("scales linearly with confidence", () => {
    const full = computeScore(base);
    const half = computeScore({ ...base, confidence: 0.5 });
    expect(half).toBeCloseTo(full / 2, 1);
  });

  it("scales linearly with source weight", () => {
    // An 8-K at 1.00 must outrank the same story from an aggregator at 0.50.
    const primary = computeScore({ ...base, sourceWeight: 1.0 });
    const aggregator = computeScore({ ...base, sourceWeight: 0.5 });
    expect(aggregator).toBeCloseTo(primary / 2, 1);
  });

  it("keeps a magnitude-1 signal worth a fifth, not nothing", () => {
    expect(computeScore({ ...base, magnitude: 1 })).toBeCloseTo(20, 1);
  });

  it("ranks a strong old signal below a weaker fresh one", () => {
    // This is the behaviour the whole feed ordering depends on.
    const strongButOld = computeScore({
      ...base,
      magnitude: 5,
      publishedAt: hoursAgo(72),
    });
    const weakButFresh = computeScore({ ...base, magnitude: 2 });
    expect(weakButFresh).toBeGreaterThan(strongButOld);
  });

  it("returns at most two decimals, matching numeric(5,2) exactly", () => {
    const s = computeScore({ ...base, confidence: 0.333333, magnitude: 3 });
    expect(s).toBe(Math.round(s * 100) / 100);
    expect(String(s).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe("rulePrior — the free scoring mode", () => {
  it("never guesses a direction", () => {
    // Nothing has read the content. Inventing a direction would poison the
    // /stats hit rate with coin flips dressed up as judgements.
    for (const source of [
      "SEC EDGAR 8-K",
      "SEC EDGAR Form 4",
      "USASpending - Federal Contract Awards",
      "CNBC - Top News",
      "something unrecognised",
    ]) {
      expect(rulePrior(source).direction).toBe("neutral");
    }
  });

  it("ranks a tender offer above a passive 13G", () => {
    expect(rulePrior("SEC EDGAR SC TO-T").magnitude).toBeGreaterThan(
      rulePrior("SEC EDGAR SC 13G").magnitude,
    );
  });

  it("ranks a late-filing notice as high-signal", () => {
    // NT 10-K is low volume and frequently precedes a restatement.
    expect(rulePrior("SEC EDGAR NT 10-K / NT 10-Q").magnitude).toBeGreaterThanOrEqual(4);
  });

  it("classifies filings into sensible event types", () => {
    expect(rulePrior("SEC EDGAR Form 4").eventType).toBe("insider_trade");
    expect(rulePrior("SEC EDGAR 10-Q").eventType).toBe("earnings");
    expect(rulePrior("USASpending - Federal Contract Awards").eventType).toBe(
      "contract_win",
    );
  });

  it("falls back to a low prior for an unknown source", () => {
    const p = rulePrior("Some Feed Nobody Configured");
    expect(p.magnitude).toBeLessThanOrEqual(2);
    expect(p.eventType).toBe("other");
  });
});
