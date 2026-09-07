import { describe, expect, it } from "vitest";
import {
  buildNameIndex,
  matchTickers,
  normalizeCompanyName,
} from "./ticker-match";

const TICKERS = [
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "VZ", name: "Verizon Communications Inc." },
  { symbol: "ROIV", name: "Roivant Sciences Ltd." },
  { symbol: "NUE", name: "Nucor Corporation" },
  { symbol: "X", name: "United States Steel Corporation" },
  { symbol: "ALL", name: "Allstate Corporation" },
  { symbol: "ON", name: "ON Semiconductor Corporation" },
  { symbol: "ZH", name: "Zhihu Inc." },
];
const KNOWN = new Set(TICKERS.map((t) => t.symbol));
const NAMES = buildNameIndex(TICKERS);

const match = (text: string) => matchTickers(text, KNOWN, NAMES);

describe("normalizeCompanyName", () => {
  it("collapses corporate suffixes so Corp and Corporation agree", () => {
    expect(normalizeCompanyName("Nucor Corporation")).toBe("nucor");
    expect(normalizeCompanyName("Nucor Corp.")).toBe("nucor");
    expect(normalizeCompanyName("NVIDIA Corporation")).toBe("nvidia");
  });
});

describe("matchTickers — positive evidence", () => {
  it("matches an exchange-qualified mention with high confidence", () => {
    // Verbatim shape from the live GlobeNewswire capture.
    const r = match("Zhihu Inc. Announces Proposed Subscription (NYSE: ZH)");
    expect(r[0].symbol).toBe("ZH");
    expect(r[0].via).toBe("exchange_tag");
    expect(r[0].confidence).toBeGreaterThan(0.9);
  });

  it("matches NASDAQ tags too", () => {
    expect(match("Roivant Sciences (NASDAQ: ROIV) will present")[0].symbol).toBe(
      "ROIV",
    );
  });

  it("matches a cashtag", () => {
    const r = match("Big day for $NVDA and the AI trade");
    expect(r[0].symbol).toBe("NVDA");
    expect(r[0].via).toBe("cashtag");
  });

  it("matches a company name without any ticker present", () => {
    // The EDGAR case: filings name the company, never the ticker.
    const r = match("8-K - Nucor Corporation (0001234567) (Filer)");
    expect(r[0].symbol).toBe("NUE");
    expect(r[0].via).toBe("company_name");
  });

  it("ranks stronger evidence first", () => {
    const r = match("Verizon Communications and (NYSE: NVDA) partner");
    expect(r[0].symbol).toBe("NVDA"); // exchange tag beats name match
    expect(r.map((m) => m.symbol)).toContain("VZ");
  });
});

describe("matchTickers — the false positives that would poison the feed", () => {
  // A wrong ticker attaches a real-looking signal to the wrong company. That
  // is worse than no signal, because you might act on it.

  it("does NOT match bare uppercase words that happen to be tickers", () => {
    // "ALL", "ON" and "X" are all real listings and all ordinary words.
    expect(match("ALL sources ON the X platform reported gains")).toEqual([]);
  });

  it("does not match a ticker mentioned without any sigil or exchange", () => {
    expect(match("The company X reported earnings")).toEqual([]);
  });

  it("does not match a symbol that is not in the known universe", () => {
    // Guards against matching a delisted or non-US symbol.
    expect(match("Shares of (NYSE: FAKE) rose")).toEqual([]);
  });

  it("does not match a company name inside a longer word", () => {
    // Word-boundary containment, not substring.
    expect(match("NucorTech Industries is unrelated")).toEqual([]);
  });

  it("drops names that two different listings share", () => {
    const dupes = [
      { symbol: "AAA", name: "Global Holdings Inc." },
      { symbol: "BBB", name: "Global Holdings Corp." },
    ];
    const index = buildNameIndex(dupes);
    // Both normalise to "global"; neither can be matched safely.
    expect(matchTickers("Global Holdings announced", new Set(["AAA", "BBB"]), index))
      .toEqual([]);
  });

  it("ignores company names too short to be distinctive", () => {
    const index = buildNameIndex([{ symbol: "ABC", name: "Co." }]);
    expect(index.size).toBe(0);
  });

  it("returns nothing for text about no listed company", () => {
    expect(match("Safety Zone; Laguna Madre, South Padre Island, TX")).toEqual([]);
  });
});
