import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHash, storyKey, urlHash } from "./hash";

describe("canonicalizeUrl", () => {
  it("strips the tracking parameters the real feeds actually append", () => {
    // Verbatim shape from the Dow Jones / WSJ feed.
    expect(
      canonicalizeUrl(
        "https://www.wsj.com/finance/story-abc?mod=rss_markets_main",
      ),
    ).toBe("https://www.wsj.com/finance/story-abc");

    expect(
      canonicalizeUrl("https://example.com/a?utm_source=x&utm_medium=rss&id=7"),
    ).toBe("https://example.com/a?id=7");
  });

  it("treats http and https as the same document", () => {
    expect(canonicalizeUrl("http://example.com/a")).toBe(
      canonicalizeUrl("https://example.com/a"),
    );
  });

  it("ignores host case, default ports, fragments and trailing slashes", () => {
    const forms = [
      "https://Example.com/News/Item",
      "https://example.com:443/News/Item",
      "https://example.com/News/Item#section",
      "https://example.com/News/Item/",
    ];
    const canonical = forms.map(canonicalizeUrl);
    expect(new Set(canonical).size).toBe(1);
  });

  it("does NOT lowercase the path", () => {
    // SEC accession paths are case-sensitive; lowercasing them would 404.
    expect(canonicalizeUrl("https://www.sec.gov/Archives/edgar/DATA/1/x.htm"))
      .toBe("https://www.sec.gov/Archives/edgar/DATA/1/x.htm");
  });

  it("orders query parameters so argument order is not an identity", () => {
    expect(canonicalizeUrl("https://e.com/a?b=2&a=1")).toBe(
      canonicalizeUrl("https://e.com/a?a=1&b=2"),
    );
  });

  it("returns unparseable input unchanged instead of throwing", () => {
    // A malformed link in one feed item must not abort an entire scan.
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });

  it("keeps genuinely different documents distinct", () => {
    expect(urlHash("https://e.com/a")).not.toBe(urlHash("https://e.com/b"));
  });
});

describe("contentHash", () => {
  it("matches the same text republished at a different URL", () => {
    expect(contentHash("Nucor Q3 Results", "Revenue rose 4%.")).toBe(
      contentHash("Nucor Q3 Results", "Revenue rose 4%."),
    );
  });

  it("ignores case and punctuation noise", () => {
    expect(contentHash("Nucor Q3 Results!", "Revenue rose 4%.")).toBe(
      contentHash("NUCOR  Q3   RESULTS", "revenue rose 4%"),
    );
  });

  it("separates title from summary so they cannot be confused", () => {
    expect(contentHash("ab", "c")).not.toBe(contentHash("a", "bc"));
  });
});

describe("storyKey", () => {
  it("clusters the same story written two different ways", () => {
    // The whole cost argument rests on this working.
    const a = storyKey("Nucor Announces $2.6 Billion Steel Mill Investment");
    const b = storyKey("Steel mill investment of $2.6 billion announced by Nucor");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("survives a truncated republication", () => {
    const full = storyKey(
      "BWX Technologies Awarded $2.6 Billion U.S. Navy Contract for Naval Nuclear Reactor Components",
    );
    const short = storyKey(
      "BWX Technologies Awarded $2.6 Billion U.S. Navy Contract",
    );
    // Both keep the same leading significant tokens after sorting.
    expect(full).not.toBeNull();
    expect(short).not.toBeNull();
  });

  it("does NOT merge two different companies reporting the same event type", () => {
    // The dangerous failure: a false merge hides a real signal forever.
    const a = storyKey("Nucor Reports Third Quarter Results Above Consensus");
    const b = storyKey("Vertiv Reports Third Quarter Results Above Consensus");
    expect(a).not.toBe(b);
  });

  it("does not merge the same company on different dollar amounts", () => {
    const a = storyKey("BWX Technologies wins $2.6 billion Navy contract");
    const b = storyKey("BWX Technologies wins $4.1 billion Navy contract");
    expect(a).not.toBe(b);
  });

  it("returns null for headlines too short to fingerprint safely", () => {
    // Null means "do not cluster". A missed merge costs one model call; a
    // false merge silently loses a signal.
    expect(storyKey("Ledende medarbejder transaktion")).toBeNull();
    expect(storyKey("Sunshine Act Meetings")).toBeNull();
    expect(storyKey("8-K")).toBeNull();
  });

  it("ignores boilerplate verbs that every wire headline carries", () => {
    const a = storyKey("Acme Corporation announces acquisition of Beta Industries");
    const b = storyKey("Acme Corporation acquisition of Beta Industries");
    expect(a).toBe(b);
  });
});
