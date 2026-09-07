/**
 * The single shape every source adapter must produce.
 *
 * Adapters know about RSS, Atom, EDGAR and half a dozen JSON APIs. Everything
 * downstream — dedupe, prefilter, storage, scoring — only ever sees this.
 */
export type RawItem = {
  /** The link a human would open. Canonicalized later, not here. */
  url: string;
  title: string;
  summary?: string | null;
  /**
   * Full text. Only ever set by adapters for sources whose `storeBody` is
   * true; the scan enforces this again before writing, so a careless adapter
   * cannot cause us to store a paywalled article body.
   */
  body?: string | null;
  /** Publication time. Adapters must not invent one — see below. */
  publishedAt: Date;
};

export type FetchResult = {
  items: RawItem[];
  /** Non-fatal notes worth surfacing on /sources, e.g. "12 items had no date". */
  warnings: string[];
};

/**
 * Parse a feed date, falling back to now().
 *
 * Falling back is deliberate and the fallback is recorded by the caller: an
 * item with no parseable date still deserves to be read. But it must never be
 * silently dated to the epoch, which would rank it last forever, nor to the
 * far future, which would pin it to the top of the feed permanently.
 */
export function parseDate(
  value: string | number | Date | null | undefined,
): { date: Date; guessed: boolean } {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value, guessed: false };
  }
  if (typeof value === "number") {
    // Feeds disagree about seconds vs milliseconds. Anything below this
    // threshold cannot be a sane millisecond timestamp.
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return { date: d, guessed: false };
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return { date: d, guessed: false };
  }
  return { date: new Date(), guessed: true };
}

/** Strip HTML and collapse whitespace. Feed summaries are full of markup. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hard cap on stored text.
 *
 * A 10-K runs to hundreds of pages. Storing it whole would bloat the database
 * and, worse, get fed to a model that charges by the token. The opening
 * section is where the material disclosure lives.
 */
export const MAX_BODY_CHARS = 20_000;
export const MAX_SUMMARY_CHARS = 4_000;

export function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
