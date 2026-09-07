import { formatInTimeZone } from "date-fns-tz";

/**
 * All timestamps are stored UTC and displayed in America/Los_Angeles.
 *
 * This matters more than it looks: an item published at 23:30 UTC belongs to
 * the *previous* PT day. Formatting with the runtime's local zone would give
 * one answer on a laptop and another on a Vercel function (which runs UTC),
 * so the zone is pinned explicitly everywhere rather than left to the host.
 */
export const DISPLAY_TZ = "America/Los_Angeles";

/** e.g. "Sep 6, 14:22 PT" */
export function formatPT(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatInTimeZone(d, DISPLAY_TZ, "MMM d, HH:mm")} PT`;
}

/** e.g. "2026-09-06" — the PT calendar date, for grouping and earnings dates. */
export function formatPTDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd");
}

/**
 * Compact age for the feed's Age column: "3m", "4h", "2d".
 *
 * Deliberately not date-fns' formatDistance ("about 4 hours ago") — that is
 * three times wider and the feed shows hundreds of rows.
 */
export function formatAge(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 0) return "0s";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 100) return `${days}d`;

  // Months bucket. Without it, anything from 100 to 364 days old floors to
  // "0y" and reads as "just now" — the exact opposite of the truth.
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo`;

  return `${Math.floor(days / 365)}y`;
}

/** Percentage return with an explicit sign: "+4.21%", "-0.80%". */
export function formatReturn(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** Price to two decimals, or an em dash when not yet known. */
export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  return price.toFixed(2);
}
