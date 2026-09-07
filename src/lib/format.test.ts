import { describe, expect, it } from "vitest";
import { formatAge, formatPT, formatPTDate, formatReturn } from "./format";

describe("formatPTDate", () => {
  it("maps a late-UTC timestamp to the previous PT calendar date", () => {
    // 23:30 UTC on Sep 6 is 16:30 PT on Sep 6 (PDT, UTC-7).
    expect(formatPTDate("2026-09-06T23:30:00Z")).toBe("2026-09-06");
  });

  it("rolls the PT date back across the UTC midnight boundary", () => {
    // 02:30 UTC on Sep 7 is still 19:30 PT on Sep 6. This is the case that
    // silently breaks if the display zone is left to the host: a Vercel
    // function runs UTC and would file this under the 7th.
    expect(formatPTDate("2026-09-07T02:30:00Z")).toBe("2026-09-06");
  });

  it("handles standard time as well as daylight time", () => {
    // January is PST (UTC-8), so 02:30 UTC on Jan 7 is 18:30 PT on Jan 6.
    expect(formatPTDate("2026-01-07T02:30:00Z")).toBe("2026-01-06");
  });
});

describe("formatPT", () => {
  it("renders wall-clock PT, not the host's local time", () => {
    expect(formatPT("2026-09-06T23:30:00Z")).toBe("Sep 6, 16:30 PT");
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-06T12:00:00Z");

  it("uses seconds under a minute", () => {
    expect(formatAge("2026-09-06T11:59:30Z", now)).toBe("30s");
  });

  it("uses minutes under an hour", () => {
    expect(formatAge("2026-09-06T11:15:00Z", now)).toBe("45m");
  });

  it("uses hours under a day", () => {
    expect(formatAge("2026-09-06T04:00:00Z", now)).toBe("8h");
  });

  it("uses days beyond that", () => {
    expect(formatAge("2026-09-01T12:00:00Z", now)).toBe("5d");
  });

  it("uses months between 100 and 364 days rather than flooring to 0y", () => {
    // Regression: the original implementation jumped straight from days to
    // Math.floor(days / 365), so 150 days rendered as "0y" and read as
    // "just happened". Caught by cross-model review of CP1.
    const d = new Date(now.getTime() - 150 * 24 * 60 * 60 * 1000);
    expect(formatAge(d, now)).toBe("5mo");
  });

  it("still reads as days just under the 100-day boundary", () => {
    const d = new Date(now.getTime() - 99 * 24 * 60 * 60 * 1000);
    expect(formatAge(d, now)).toBe("99d");
  });

  it("uses years past a full year", () => {
    const d = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    expect(formatAge(d, now)).toBe("1y");
  });

  it("clamps a future timestamp to zero rather than rendering negative age", () => {
    // Feeds do publish timestamps slightly in the future; "-3s" in the Age
    // column looks like a bug to the reader.
    expect(formatAge("2026-09-06T12:00:03Z", now)).toBe("0s");
  });
});

describe("formatReturn", () => {
  it("always shows an explicit sign", () => {
    expect(formatReturn(4.213)).toBe("+4.21%");
    expect(formatReturn(-0.8)).toBe("-0.80%");
    expect(formatReturn(0)).toBe("+0.00%");
  });

  it("renders an em dash when the outcome is not yet known", () => {
    // Pending outcomes are the common case for the first 20 trading days, so
    // null must not render as "NaN%" or "0.00%" — both would be read as data.
    expect(formatReturn(null)).toBe("—");
    expect(formatReturn(undefined)).toBe("—");
    expect(formatReturn(Number.NaN)).toBe("—");
  });
});
