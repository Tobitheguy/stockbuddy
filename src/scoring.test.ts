import { describe, expect, it } from "vitest";
import { computeScore, recencyDecay, rulePrior, displayScore, scoreBand, SCORE_BANDS } from "./scoring";

const NOW = new Date("2026-09-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("recencyDecay", () => {
  it("is 1 for something published right now", () => {
    expect(recencyDecay(NOW, NOW, "days")).toBe(1);
  });

  it("halves at exactly one half-life", () => {
    // "days" half-life is 36 hours: overnight plus a margin.
    expect(recencyDecay(hoursAgo(36), NOW, "days")).toBeCloseTo(0.5, 6);
    expect(recencyDecay(hoursAgo(72), NOW, "days")).toBeCloseTo(0.25, 6);
  });

  /**
   * The requirement that set the half-lives: a catalyst found overnight must
   * still be near the top when the user looks in the morning. At the original
   * 18 hours it kept 40% and a filing that scored 85 fresh displayed as 17 —
   * the tool found the thing and then hid it.
   */
  it("keeps most of a signal's score overnight", () => {
    expect(recencyDecay(hoursAgo(12), NOW, "days")).toBeGreaterThan(0.75);
    expect(recencyDecay(hoursAgo(24), NOW, "days")).toBeGreaterThan(0.6);
  });

  it("decays a long-horizon signal more slowly than a short one", () => {
    // The point of horizon-aware decay: a tariff is still actionable a week
    // later; an earnings surprise is not.
    const week = 24 * 7;
    const short = recencyDecay(hoursAgo(week), NOW, "days");
    const long = recencyDecay(hoursAgo(week), NOW, "months");
    expect(long).toBeGreaterThan(short);
  });

  /**
   * The bound that keeps the feed a feed.
   *
   * The gradient above used to be 20:1 — 720 hours against 36 — and a
   * high-scoring "weeks" signal became unbeatable: measured on live data a
   * 68-point filing still displayed 50 after three days, against a 95th
   * percentile of 41 for everything scored that week. Nothing new could reach
   * the top.
   *
   * So the gradient is asserted in BOTH directions. Long horizons must decay
   * slower, and they must still decay fast enough that a stale exceptional
   * signal drops below what a fresh strong one can reach — which is the
   * property that actually failed, and the one worth pinning.
   *
   * The numbers are the measured ones: 68 was the highest "weeks" base score
   * in the database, 41 the 95th percentile of everything scored that week.
   * Under the old 168-hour half-life the stale 68 displayed as 50 and nothing
   * published since could catch it.
   */
  it("lets a fresh strong signal overtake a stale exceptional one", () => {
    const threeDays = 24 * 3;
    const STALE_EXCEPTIONAL = 68;
    const FRESH_STRONG = 41;

    for (const horizon of ["days", "weeks", "months"] as const) {
      const stale = STALE_EXCEPTIONAL * recencyDecay(hoursAgo(threeDays), NOW, horizon);
      expect(stale).toBeLessThan(FRESH_STRONG);
    }
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

  /**
   * Source weight is compressed onto 0.65-1.0, not applied raw.
   *
   * It used to scale linearly, which charged the same story twice: the scoring
   * prompt already tells the model to lower confidence for rumours and
   * second-hand reports, so an aggregator's item arrived with a confidence
   * that had absorbed that judgement — and then lost another 50% on top. With
   * 187 of 228 model signals coming from a single 0.70 source, that second
   * charge was applied to almost the whole feed.
   */
  it("compresses source weight instead of scaling linearly", () => {
    const primary = computeScore({ ...base, sourceWeight: 1.0 });
    const aggregator = computeScore({ ...base, sourceWeight: 0.5 });

    // Ordering must survive: a primary filing still beats a wire summary.
    expect(aggregator).toBeLessThan(primary);
    // But the penalty is a modifier, not a halving.
    expect(aggregator).toBeGreaterThan(primary * 0.8);
    expect(aggregator).toBeCloseTo(primary * 0.825, 1);
  });

  it("never lets provenance alone annihilate a signal", () => {
    // A source we would not trust at all does not belong in the sources table.
    // One that is there must not be able to zero out a real catalyst.
    const worthless = computeScore({ ...base, sourceWeight: 0 });
    expect(worthless).toBeGreaterThan(0);
    expect(worthless).toBeCloseTo(
      computeScore({ ...base, sourceWeight: 1 }) * 0.65,
      1,
    );
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

describe("displayScore", () => {
  /**
   * The stretch exists because a raw product of four sub-1 factors reads as a
   * failing grade to anyone who has ever seen a percentage. It must open up
   * the mid-range without ever reordering anything.
   */
  it("is strictly monotonic — the ranking is untouched", () => {
    let prev = -1;
    for (let raw = 0; raw <= 100; raw += 0.5) {
      const d = displayScore(raw);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it("keeps the endpoints fixed", () => {
    expect(displayScore(0)).toBe(0);
    expect(displayScore(100)).toBe(100);
  });

  it("maps the measured landmarks onto readable numbers", () => {
    // Raw 30 is the top of a normal day; it must read like one.
    expect(displayScore(30)).toBe(49);
    expect(displayScore(45)).toBe(62);
    expect(displayScore(10)).toBe(25);
  });
});

describe("scoreBand", () => {
  it("labels the measured top of a normal day as strong, not failing", () => {
    expect(scoreBand(displayScore(30)).label).toBe("Strong");
    expect(scoreBand(displayScore(18)).label).toBe("Notable");
    expect(scoreBand(displayScore(45)).label).toBe("Rare");
  });

  it("covers the whole range with no gap", () => {
    for (let s = 0; s <= 100; s += 0.5) {
      expect(scoreBand(s)).toBeDefined();
    }
  });

  it("is monotonic — a higher score never lands in a lower band", () => {
    const order = SCORE_BANDS.map((b) => b.label);
    let lastIndex = order.length;
    for (let s = 0; s <= 100; s += 0.5) {
      const index = order.indexOf(scoreBand(s).label);
      expect(index).toBeLessThanOrEqual(lastIndex);
      lastIndex = index;
    }
  });
});
