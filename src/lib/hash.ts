import { createHash } from "node:crypto";

/**
 * Identity and deduplication primitives.
 *
 * Three different questions, three different fingerprints:
 *
 *   urlHash      "Is this the exact same document?"       — canonical URL
 *   contentHash  "Is this the same text at a new URL?"    — title + summary
 *   storyKey     "Is this the same STORY from a different
 *                 outlet?"                                — title token set
 *
 * The third is the expensive one to get right and the one that saves the most
 * money: every duplicate it catches is a model call not made.
 */

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Tracking and syndication parameters that change per-referrer but never
 * change the document. Left in, the same press release arrives as a dozen
 * distinct "new" items.
 */
const JUNK_PARAMS = [
  /^utm_/i,
  /^ic[ei]d$/i,
  /^mod$/i, // Dow Jones feeds append ?mod=rss_markets_main
  /^ref$/i,
  /^ref_src$/i,
  /^source$/i,
  /^src$/i,
  /^cmpid$/i,
  /^partner$/i,
  /^yptr$/i,
  /^guccounter$/i,
  /^feed_id$/i,
  /^guce_referrer/i,
  /^__twitter_impression$/i,
  /^fbclid$/i,
  /^gclid$/i,
];

/**
 * Canonical form of a URL for identity purposes.
 *
 * Deliberately conservative: it lowercases the host (which is
 * case-insensitive per RFC) but NEVER lowercases the path, because plenty of
 * real URLs — including SEC accession paths — are case-sensitive.
 */
export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    // Not a parseable URL. Return it trimmed so it can still act as an
    // identity, rather than throwing inside a scan and killing the run.
    return raw.trim();
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // http and https for the same host are the same document.
  if (u.protocol === "http:") u.protocol = "https:";

  // Default ports carry no information.
  if (
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80")
  ) {
    u.port = "";
  }

  // Fragments are client-side only.
  u.hash = "";

  for (const key of [...u.searchParams.keys()]) {
    if (JUNK_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  // Stable order, so ?a=1&b=2 and ?b=2&a=1 are one document.
  u.searchParams.sort();

  let out = u.toString();
  // A trailing slash on a path is not a different document. Left alone at the
  // root, where "https://x.com/" is the conventional form.
  if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
  // URLSearchParams leaves a bare "?" behind when every param was dropped.
  out = out.replace(/\?$/, "");

  return out;
}

export function urlHash(raw: string): string {
  return sha256(canonicalizeUrl(raw));
}

export function contentHash(title: string, summary?: string | null): string {
  return sha256(`${normalizeText(title)}\n${normalizeText(summary ?? "")}`);
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents
    .toLowerCase()
    .replace(/['’`]/g, "") // don't split "company's" into two tokens
    // Keep decimals intact BEFORE punctuation is stripped. Without this,
    // "$2.6 billion" becomes the tokens "2" and "6", both of which are then
    // dropped as too short — so the number that distinguishes two otherwise
    // identical contract headlines vanishes entirely. "p" for point.
    .replace(/(\d)[.,](\d)/g, "$1p$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Words that carry no identity. Kept deliberately small — an aggressive
 * stoplist starts merging genuinely different stories, which is a far worse
 * failure than paying to read one duplicate.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "for", "to", "in", "on", "at",
  "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "will", "has", "have", "had",
  "after", "over", "into", "amid", "says", "said", "report", "reports",
  "update", "updates", "announces", "announced", "announcement",
]);

/**
 * Fingerprint for cross-source story clustering.
 *
 * Built from the SORTED SET of significant title tokens, so headline order and
 * wording differences do not defeat it:
 *
 *   "Nucor Announces $2.6B Steel Mill Investment"
 *   "Steel mill investment of $2.6 billion announced by Nucor"
 *
 * both reduce to the same key.
 *
 * Returns null for titles too short to fingerprint safely. Null means "do not
 * cluster this" — which is the right default, because a false merge silently
 * hides a real signal, while a missed merge only costs one model call.
 */
export function storyKey(title: string): string | null {
  const tokens = normalizeText(title)
    .split(" ")
    // Short tokens are usually noise — except numbers, which are often the
    // only thing separating two headlines about the same company and the same
    // kind of event. A "$4.1bn" contract is not a "$2.6bn" contract.
    .filter((t) => (/\d/.test(t) || t.length > 2) && !STOPWORDS.has(t));

  // Numbers matter a lot here: "$2.6 billion" is often the only thing
  // distinguishing two otherwise identical contract headlines. Keep them.
  const unique = [...new Set(tokens)].sort();

  // Fewer than four significant tokens is not enough to be confident two
  // headlines are the same story.
  if (unique.length < 4) return null;

  // Cap the token count so a long headline and its truncated republication
  // still agree.
  return sha256(unique.slice(0, 12).join(" "));
}
