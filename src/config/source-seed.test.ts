import { describe, expect, it } from "vitest";
import { SEED_SOURCES } from "./source-seed";

/**
 * These tests exist so that editing source-seed.ts wrongly fails here, in a
 * one-second test run, rather than at seed time against a live database.
 *
 * Several assertions mirror CHECK constraints in src/db/schema.ts. That
 * duplication is deliberate: the database is the last line of defence, but a
 * constraint violation during `npm run db:seed` is a much worse place to
 * discover a typo than a red test.
 */
describe("SEED_SOURCES", () => {
  it("has no duplicate names", () => {
    // `name` is UNIQUE in the sources table, and the seed upserts on it, so a
    // duplicate would silently make one entry overwrite the other.
    const names = SEED_SOURCES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no duplicate URLs", () => {
    const urls = SEED_SOURCES.map((s) => s.url);
    const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
    expect(dupes).toEqual([]);
  });

  it("satisfies the sources_quality_weight_range check", () => {
    for (const s of SEED_SOURCES) {
      expect(s.qualityWeight, s.name).toBeGreaterThanOrEqual(0);
      expect(s.qualityWeight, s.name).toBeLessThanOrEqual(1);
    }
  });

  it("satisfies the sources_poll_interval_positive check", () => {
    // The DB floor is 30s. Anything lower would hammer a free feed on every
    // invocation, which is how you get blocked.
    for (const s of SEED_SOURCES) {
      expect(s.pollIntervalSec, s.name).toBeGreaterThanOrEqual(30);
    }
  });

  it("uses https everywhere except where a host forces otherwise", () => {
    for (const s of SEED_SOURCES) {
      expect(s.url, s.name).toMatch(/^https?:\/\//);
    }
  });

  it("never enables a source that is not verified live", () => {
    // The rule stated at the top of source-seed.ts. It was violated once
    // already (openFDA enforcement shipped enabled while unverified), which is
    // exactly why it is asserted here rather than trusted.
    const violations = SEED_SOURCES.filter(
      (s) => s.enabled && s.verified !== "live",
    ).map((s) => `${s.name} (${s.verified})`);
    expect(violations).toEqual([]);
  });

  it("only stores full body text for public-domain or wire sources", () => {
    // The content rule. Third-party news bodies must never be persisted.
    const NEWS_HOSTS = [
      "wsj.com",
      "dowjones.io",
      "yahoo.com",
      "cnbc.com",
      "reuters",
      "apnews.com",
      "seekingalpha.com",
      "reddit.com",
    ];
    const violations = SEED_SOURCES.filter(
      (s) => s.storeBody && NEWS_HOSTS.some((h) => s.url.includes(h)),
    ).map((s) => s.name);
    expect(violations).toEqual([]);
  });

  it("gives every source a non-empty note", () => {
    // The notes are how a future reader knows why a weight or an interval is
    // what it is. An unexplained source is one nobody will dare to delete.
    for (const s of SEED_SOURCES) {
      expect(s.notes.length, s.name).toBeGreaterThan(10);
    }
  });

  it("weights primary documents above the outlets that relay them", () => {
    const bySlug = (needle: string) =>
      SEED_SOURCES.find((s) => s.name.includes(needle));

    const eightK = bySlug("8-K");
    const wire = bySlug("GlobeNewswire - Public Companies");
    const aggregator = bySlug("Yahoo Finance");

    expect(eightK).toBeDefined();
    expect(wire).toBeDefined();
    expect(aggregator).toBeDefined();

    // The whole ranking model rests on this ordering being true.
    expect(eightK!.qualityWeight).toBeGreaterThan(wire!.qualityWeight);
    expect(wire!.qualityWeight).toBeGreaterThan(aggregator!.qualityWeight);
  });
});
