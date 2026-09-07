import { describe, expect, it } from "vitest";
import { prefilter } from "./prefilter";
import { storyKey } from "@/lib/hash";

const base = {
  sourceName: "GlobeNewswire - Public Companies",
  storyKey: null,
  allowStoryClustering: true,
};

describe("prefilter — what it drops", () => {
  it("drops Danish insider notices from the wire feeds", () => {
    // Verbatim from the live GlobeNewswire capture in fixtures/raw.
    const r = prefilter({ ...base, title: "Ledende medarbejder transaktion" });
    expect(r).toEqual({ drop: true, reason: "non_english" });
  });

  it("drops administrative notices", () => {
    // Verbatim from the live Federal Register capture.
    const r = prefilter({
      ...base,
      sourceName: "Federal Register",
      allowStoryClustering: false,
      title: "Sunshine Act Meetings",
    });
    expect(r).toEqual({ drop: true, reason: "administrative" });
  });

  it("drops routine 10b5-1 vesting on Form 4", () => {
    const r = prefilter({
      sourceName: "SEC EDGAR Form 4",
      storyKey: null,
      allowStoryClustering: false,
      title: "4 - Officer routine equity award",
      summary:
        "Acquired 4,120 shares pursuant to a previously scheduled restricted stock unit vesting and disposed of 1,806 shares to satisfy tax withholding obligations. Executed under a Rule 10b5-1 trading plan.",
    });
    expect(r).toEqual({ drop: true, reason: "form4_routine" });
  });

  it("drops an empty title", () => {
    expect(prefilter({ ...base, title: "   " })).toEqual({
      drop: true,
      reason: "empty_title",
    });
  });

  it("drops the second outlet carrying the same story", () => {
    const key = storyKey("Nucor Announces $2.6 Billion Steel Mill Investment")!;
    const r = prefilter({
      ...base,
      title: "Steel mill investment of $2.6 billion announced by Nucor",
      storyKey: key,
      seenStoryKeys: new Set([key]),
    });
    expect(r).toEqual({ drop: true, reason: "duplicate_story" });
  });
});

describe("prefilter — what it must NEVER drop", () => {
  // A false drop loses a real signal forever with no way to notice it.
  // These are the cases where being too clever would cost money.

  it("keeps an unplanned open-market insider purchase", () => {
    // The one insider pattern that genuinely carries information. It mentions
    // shares and vesting-adjacent language, so a lazy rule would eat it.
    const r = prefilter({
      sourceName: "SEC EDGAR Form 4",
      storyKey: null,
      allowStoryClustering: false,
      title: "4 - Chief Executive Officer open-market purchase, $4.1 million",
      summary:
        "Reporting person acquired 210,000 shares in an open-market purchase at a weighted average price of $19.52. No trading plan is referenced.",
    });
    expect(r.drop).toBe(false);
  });

  it("keeps an insider purchase even when a 10b5-1 plan is mentioned", () => {
    // Mentioning a plan is not the same as the trade being automatic.
    const r = prefilter({
      sourceName: "SEC EDGAR Form 4",
      storyKey: null,
      allowStoryClustering: false,
      title: "4 - Director purchase",
      summary:
        "Purchased 50,000 shares on the open market. Reporting person also maintains a Rule 10b5-1 plan for unrelated dispositions.",
    });
    expect(r.drop).toBe(false);
  });

  it("does not run the language heuristic on SEC filings", () => {
    // "Und" and "Der" appear inside real US company names. Dropping an 8-K
    // because of a substring in the issuer name would be a silent disaster.
    const r = prefilter({
      sourceName: "SEC EDGAR 8-K",
      storyKey: null,
      allowStoryClustering: false,
      title: "8-K - UND Holdings Der Corp (0001234567) (Filer)",
    });
    expect(r.drop).toBe(false);
  });

  it("keeps an English wire release that merely mentions a foreign place", () => {
    const r = prefilter({
      ...base,
      title: "Verizon Waives Charges for Hurricane Lowell, Prepares Network in Hawai'i",
    });
    expect(r.drop).toBe(false);
  });

  it("keeps the FIRST arrival of a story", () => {
    const key = storyKey("Nucor Announces $2.6 Billion Steel Mill Investment")!;
    const r = prefilter({
      ...base,
      title: "Nucor Announces $2.6 Billion Steel Mill Investment",
      storyKey: key,
      seenStoryKeys: new Set(),
    });
    expect(r.drop).toBe(false);
  });

  it("keeps an item whose title was too short to fingerprint", () => {
    // storyKey returns null for short titles. Null must mean "do not cluster",
    // never "cluster with everything else that is also null".
    const r = prefilter({
      ...base,
      title: "8-K",
      storyKey: null,
      seenStoryKeys: new Set(),
    });
    expect(r.drop).toBe(false);
  });

  it("keeps a real high-value signal", () => {
    const r = prefilter({
      ...base,
      title:
        "BWX Technologies Awarded $2.6 Billion U.S. Navy Contract for Naval Nuclear Reactor Components",
      storyKey: storyKey("BWX Technologies Awarded $2.6 Billion U.S. Navy Contract"),
      seenStoryKeys: new Set(),
    });
    expect(r.drop).toBe(false);
  });
});

describe("prefilter — the EDGAR clustering regression", () => {
  // Found on live data an hour after shipping: EDGAR titles are formulaic, so
  // six SEPARATE Form 4 filings by six different Veracyte insiders all carry
  // the identical title. Clustering merged them and discarded five real
  // filings — the exact silent-signal-loss failure the design warns about.
  const EDGAR_TITLE = "4 - VERACYTE, INC. (0001384101) (Issuer)";

  it("does NOT cluster identical EDGAR titles", () => {
    const key = storyKey(EDGAR_TITLE);
    const second = prefilter({
      sourceName: "SEC EDGAR Form 4",
      title: EDGAR_TITLE,
      storyKey: key,
      seenStoryKeys: new Set(key ? [key] : []),
      allowStoryClustering: false,
    });
    expect(second.drop).toBe(false);
  });

  it("still clusters identical headlines from editorial sources", () => {
    // The rule must stay off for EDGAR without disabling the feature itself.
    const title = "Nucor Announces $2.6 Billion Steel Mill Investment";
    const key = storyKey(title)!;
    const second = prefilter({
      sourceName: "CNBC - Top News",
      title,
      storyKey: key,
      seenStoryKeys: new Set([key]),
      allowStoryClustering: true,
    });
    expect(second).toEqual({ drop: true, reason: "duplicate_story" });
  });
});
