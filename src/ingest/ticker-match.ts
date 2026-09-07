/**
 * Match free text to US-listed ticker symbols — without a model.
 *
 * This is load-bearing in two ways: it is what makes SCORING_MODE=off useful
 * at all, and it is what lets the prefilter drop items that concern no listed
 * company before anything expensive reads them.
 *
 * PRECISION OVER RECALL, deliberately. A wrong ticker attaches a real-looking
 * signal to the wrong company, which is worse than no signal — you might act
 * on it. A missed ticker just means the item ranks lower. So every rule here
 * requires positive evidence, and bare uppercase tokens are never matched:
 * "ALL", "ON", "IT", "SO", "KEY", "CAR" and "X" are all real tickers and all
 * ordinary English words. Matching those would poison the feed.
 */

export type TickerRef = { symbol: string; name: string };

export type TickerMatch = {
  symbol: string;
  /** How the match was made, so /stats can measure which rules are reliable. */
  via: "cik" | "exchange_tag" | "cashtag" | "company_name";
  /** 0-1. Feeds the signal's confidence in rule-based mode. */
  confidence: number;
};

/**
 * "(CIK 0001702924)" — written into EDGAR summaries by the edgar adapter.
 *
 * This is the only exact identifier in the whole matching pipeline. EDGAR
 * filings name a company by CIK and never by ticker, so everything else about
 * a filing has to be matched by fuzzy name comparison; this does not.
 */
const CIK_RE = /\(CIK\s*(\d{10})\)/gi;

/** "(NYSE: VZ)", "(NASDAQ:ROIV)", "(Nasdaq: ZH)" — unambiguous by construction. */
const EXCHANGE_TAG_RE =
  /\((?:NYSE|NASDAQ|NYSE\s*American|AMEX|OTC|CBOE)\s*:\s*([A-Z][A-Z.\-]{0,6})\)/gi;

/** "$NVDA" — the cashtag convention. Requires the sigil, so no false hits. */
const CASHTAG_RE = /\$([A-Z]{1,5})\b/g;

/**
 * Corporate suffixes stripped before comparing company names, so
 * "Nucor Corporation" and "Nucor Corp." both reduce to "nucor".
 */
const SUFFIX_RE =
  /\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the|sa|nv|ag|se)\b/gi;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'’&]/g, " ")
    .replace(SUFFIX_RE, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Company names too generic to match on. Matching "Stewards" or "Global" as a
 * company name would attach signals to whatever happens to share the word.
 */
const MIN_NAME_LENGTH = 4;

export function buildNameIndex(
  tickers: readonly TickerRef[],
): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const t of tickers) {
    const key = normalizeCompanyName(t.name);
    if (key.length < MIN_NAME_LENGTH) continue;

    if (index.has(key) && index.get(key) !== t.symbol) {
      // Two listed companies normalise to the same name. Neither can be
      // matched safely, so drop both rather than pick one.
      ambiguous.add(key);
      continue;
    }
    index.set(key, t.symbol);
  }

  for (const key of ambiguous) index.delete(key);
  return index;
}

export function matchTickers(
  text: string,
  known: ReadonlySet<string>,
  nameIndex: ReadonlyMap<string, string>,
  cikIndex?: ReadonlyMap<string, string>,
): TickerMatch[] {
  const found = new Map<string, TickerMatch>();

  const add = (symbol: string, via: TickerMatch["via"], confidence: number) => {
    const upper = symbol.toUpperCase().trim();
    if (!known.has(upper)) return; // must be a real, active US listing
    const prev = found.get(upper);
    if (!prev || prev.confidence < confidence) {
      found.set(upper, { symbol: upper, via, confidence });
    }
  };

  // 1. CIK. Exact, not heuristic — the SEC's own identifier for the filer,
  //    resolved through the SEC's own ticker mapping. Nothing beats this.
  if (cikIndex && cikIndex.size > 0) {
    for (const m of text.matchAll(CIK_RE)) {
      const symbol = cikIndex.get(m[1]);
      if (symbol) add(symbol, "cik", 1.0);
    }
  }

  // 2. Exchange-qualified mentions. The strongest evidence a press release
  //    gives: the publisher has stated the exchange and the symbol.
  for (const m of text.matchAll(EXCHANGE_TAG_RE)) add(m[1], "exchange_tag", 0.95);

  // 3. Cashtags.
  for (const m of text.matchAll(CASHTAG_RE)) add(m[1], "cashtag", 0.8);

  // 4. Company names. Weakest of the four, so it scores lowest.
  if (nameIndex.size > 0) {
    const haystack = ` ${normalizeCompanyName(text)} `;
    for (const [name, symbol] of nameIndex) {
      // Word-boundary containment, not substring: "sonos" must not match
      // inside "sonoscape".
      if (haystack.includes(` ${name} `)) add(symbol, "company_name", 0.6);
    }
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}
