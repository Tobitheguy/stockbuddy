/**
 * Rule-based prefilter — the free stage.
 *
 * Runs before any model call and drops items that provably cannot be a US
 * equity signal. This is the single biggest cost lever in the system: every
 * item dropped here is a model call not made, and it costs nothing to run.
 *
 * DESIGN RULE: this filter is biased hard toward keeping things.
 *
 * A false drop silently loses a real signal forever and there is no way to
 * notice. A false keep costs $0.0005. Those are not remotely symmetrical, so
 * every rule here has to be one that is *obviously* right, not merely usually
 * right. Anything requiring judgement belongs to the model, which is what it
 * is for.
 *
 * Nothing is deleted: the reason is recorded on the item so /stats can show
 * what was filtered and prove the filter is not eating signals.
 */

export type PrefilterReason =
  | "empty_title"
  | "non_english"
  | "form4_routine"
  | "duplicate_story"
  | "administrative";

export type PrefilterResult =
  | { drop: false }
  | { drop: true; reason: PrefilterReason };

const KEEP: PrefilterResult = { drop: false };

/**
 * Words that appear in Nordic and German press releases and effectively never
 * in English financial news. GlobeNewswire's public-companies feed carries a
 * lot of these — Danish insider notices, Norwegian aquaculture updates — and
 * none of them concern a US-listed issuer.
 *
 * Matched as whole words against the lowercased title. Deliberately built from
 * function words rather than nouns: a noun like "transaktion" could plausibly
 * appear in an English headline about a foreign company, but "og" and "för"
 * cannot.
 */
const NON_ENGLISH_MARKERS = [
  // Danish / Norwegian
  "ledende", "medarbejder", "aktier", "selskabets", "meddelelse", "og",
  "til", "fra", "aktie", "kvartal", "regnskab", "bestyrelsen", "vedr",
  // Swedish
  "för", "och", "aktien", "bolaget", "delårsrapport", "kvartalsrapport",
  // German
  "und", "der", "die", "das", "für", "mitteilung", "hauptversammlung",
  "geschäftsbericht", "aktionäre",
  // Finnish
  "yhtiö", "osakkeenomistajat", "osavuosikatsaus",
  // French
  "société", "résultats", "actionnaires", "exercice",
];

const NON_ENGLISH_RE = new RegExp(
  `(?:^|\\s)(?:${NON_ENGLISH_MARKERS.join("|")})(?:\\s|$)`,
  "i",
);

/**
 * Form 4 transaction patterns that are routine compensation mechanics rather
 * than a view on the stock.
 *
 * A scheduled RSU vesting, or a same-day sale purely to cover tax withholding,
 * tells you nothing — the insider had no choice about the timing. An
 * unplanned open-market purchase is one of the few genuinely informative
 * insider signals, so the rules below are written to match ONLY the routine
 * case and to bail out the moment anything looks discretionary.
 */
const ROUTINE_INSIDER_RE =
  /\b(?:10b5-1|rule 10b5|automatic (?:sale|disposition)|tax withholding|withholding obligation|scheduled vesting|restricted stock unit vesting|rsu vesting|net share settlement|share settlement to cover)\b/i;

/** Signs the insider made a choice. Any of these overrides the routine rule. */
const DISCRETIONARY_RE =
  /\b(?:open[- ]market purchase|open market purchase|acquired .{0,30}open market|purchased .{0,30}shares|discretionary)\b/i;

/**
 * Purely administrative filings and notices with no economic content.
 * Matched conservatively against the whole title.
 */
const ADMINISTRATIVE_RE =
  /^(?:sunshine act meetings?|notice of meetings?|media advisory|correction|korrektion)\b/i;

export type PrefilterInput = {
  title: string;
  summary?: string | null;
  /** Source name, so source-specific rules can be scoped correctly. */
  sourceName: string;
  /** Story fingerprint; null when the title was too short to fingerprint. */
  storyKey: string | null;
  /** Story keys already seen in this scan or recently in the database. */
  seenStoryKeys?: ReadonlySet<string>;
};

export function prefilter(input: PrefilterInput): PrefilterResult {
  const title = (input.title ?? "").trim();

  if (title.length === 0) return { drop: true, reason: "empty_title" };

  if (ADMINISTRATIVE_RE.test(title)) {
    return { drop: true, reason: "administrative" };
  }

  // Language check applies only to the wire feeds that actually carry foreign
  // releases. Government and EDGAR sources are English by definition, and
  // running the heuristic on them is pure downside: "und" appearing inside a
  // company name should never drop an 8-K.
  const isWire = /globenewswire|business wire|pr newswire/i.test(
    input.sourceName,
  );
  if (isWire && NON_ENGLISH_RE.test(title)) {
    return { drop: true, reason: "non_english" };
  }

  // Routine insider mechanics — Form 4 only.
  if (/form 4|edgar form 4/i.test(input.sourceName)) {
    const haystack = `${title}\n${input.summary ?? ""}`;
    if (ROUTINE_INSIDER_RE.test(haystack) && !DISCRETIONARY_RE.test(haystack)) {
      return { drop: true, reason: "form4_routine" };
    }
  }

  // Cross-source story clustering. The first arrival wins and is scored; later
  // copies from other outlets are recorded and skipped.
  if (input.storyKey && input.seenStoryKeys?.has(input.storyKey)) {
    return { drop: true, reason: "duplicate_story" };
  }

  return KEEP;
}

/** Human labels for the /sources and /stats views. */
export const PREFILTER_LABEL: Record<PrefilterReason, string> = {
  empty_title: "No title",
  non_english: "Not English",
  form4_routine: "Routine insider vesting",
  duplicate_story: "Same story, earlier source",
  administrative: "Administrative notice",
};
