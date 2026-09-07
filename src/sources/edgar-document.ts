import { fetchJson, fetchText, secRateLimited } from "./fetch";
import { cap, MAX_BODY_CHARS, stripHtml } from "./types";

/**
 * Fetch the actual text of an EDGAR filing.
 *
 * WHY THIS EXISTS. EDGAR's Atom feed carries metadata only. For a merger
 * communication it gives us exactly this:
 *
 *   "425 - SYSCO CORP (0000096021) (Subject)"
 *   "Filed by: SYSCO CORP. Form type: 425. AccNo: … Size: 974 KB"
 *
 * A model asked to score that is reasoning from a filename. It knows a merger
 * filing exists and nothing about the merger — not the counterparty, not the
 * price, not the terms — and correctly answers with low confidence. That is
 * the real reason early scores were in the teens: not a broken formula, but a
 * model reading directory listings.
 *
 * Fetching costs two SEC requests per filing, so it runs lazily — only for
 * items that are about to be sent to a model anyway. If we are already paying
 * for inference, two more requests to make that inference worth something is
 * an obvious trade.
 */

/** Enough for the substance of a filing; the tail is boilerplate and exhibits. */
const DOC_CHAR_LIMIT = Math.min(MAX_BODY_CHARS, 18_000);

type IndexJson = {
  directory?: { item?: Array<{ name?: string; size?: string }> };
};

/**
 * Turn a filing index URL into its directory listing URL.
 *   …/000095014226002499/0000950142-26-002499-index.htm
 * → …/000095014226002499/index.json
 */
function indexJsonUrl(indexUrl: string): string | null {
  try {
    const u = new URL(indexUrl);
    if (!u.hostname.endsWith("sec.gov")) return null;
    const dir = u.pathname.replace(/\/[^/]*$/, "");
    if (!dir.includes("/Archives/edgar/data/")) return null;
    return `${u.origin}${dir}/index.json`;
  } catch {
    return null;
  }
}

/**
 * Pick the primary document from a filing's file list.
 *
 * The complete-submission .txt is deliberately NOT used: it concatenates every
 * exhibit, so for the Sysco 425 it opened with 900 KB of credit-agreement
 * table-of-contents before reaching a word about the merger. The primary
 * document is the first real .htm — small, and the actual communication.
 */
export function pickPrimaryDocument(
  items: Array<{ name?: string; size?: string }>,
): string | null {
  const candidates = items
    .map((i) => ({ name: i.name ?? "", size: Number(i.size ?? 0) }))
    .filter(
      (i) =>
        /\.(htm|html)$/i.test(i.name) &&
        !/index/i.test(i.name) &&
        // Exhibits are supporting material, not the announcement.
        !/^.*ex[-_]?\d/i.test(i.name),
    );

  if (candidates.length === 0) return null;
  // Filings list the primary document first; keep that order rather than
  // guessing by size, which would pick a long exhibit over a short notice.
  return candidates[0].name;
}

/**
 * Returns the filing's primary document as plain text, or null if it cannot
 * be resolved. Never throws — a failed enrichment must degrade to scoring on
 * metadata, not abort the run.
 */
export async function fetchFilingText(
  indexUrl: string,
): Promise<string | null> {
  const jsonUrl = indexJsonUrl(indexUrl);
  if (!jsonUrl) return null;

  try {
    const listing = await secRateLimited(() =>
      fetchJson<IndexJson>(jsonUrl, { sec: true }),
    );
    const primary = pickPrimaryDocument(listing.directory?.item ?? []);
    if (!primary) return null;

    const docUrl = jsonUrl.replace(/index\.json$/, primary);
    const html = await secRateLimited(() =>
      fetchText(docUrl, { sec: true, timeoutMs: 30_000 }),
    );

    const text = stripHtml(html);
    if (text.length < 200) return null; // nothing useful in it
    return cap(text, DOC_CHAR_LIMIT);
  } catch {
    return null;
  }
}
