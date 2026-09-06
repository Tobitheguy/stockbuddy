/**
 * Seed list of ingestion sources.
 *
 * Every entry was checked against the live endpoint on 2026-09-06. The
 * `verified` field records that check so we never silently ship a dead feed:
 *
 *   "live"      - fetched successfully, returned parseable, current items.
 *   "blocked"   - the host refused our probe (403). May still work from a
 *                 server with a browser-like User-Agent, so it ships DISABLED
 *                 and must be proven by a real scan before being switched on.
 *
 * Content rule: for `rss` news sources we persist title + summary + link only.
 * Full body text is persisted only for public-domain government material
 * (EDGAR filings, Federal Register, Federal Reserve) and for press-release
 * wires, which publish releases for redistribution. No HTML scraping of
 * paywalled or scrape-prohibiting sites — feeds and official APIs only.
 */

export type SourceKind = "rss" | "api" | "edgar";

export type SeedSource = {
  name: string;
  kind: SourceKind;
  url: string;
  enabled: boolean;
  /** Seconds between polls. The scanner skips a source until this has elapsed. */
  pollIntervalSec: number;
  /**
   * Multiplier on the signal score, 0-1. Reflects how close the source is to
   * the primary document and how much noise it carries. A company's own 8-K is
   * the event; a blog aggregating it is not.
   */
  qualityWeight: number;
  /** Whether to persist full body text (see content rule above). */
  storeBody: boolean;
  verified: "live" | "blocked";
  notes: string;
};

export const SEED_SOURCES: SeedSource[] = [
  // --- SEC EDGAR -----------------------------------------------------------
  // The highest-value source in the list: complete, free, full text, and it is
  // where company-originated events legally must appear first.
  {
    name: "SEC EDGAR 8-K",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 60,
    qualityWeight: 1.0,
    storeBody: true,
    verified: "live",
    notes: "Material events: M&A, contract wins, guidance, management change.",
  },
  {
    name: "SEC EDGAR 10-Q",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.95,
    storeBody: true,
    verified: "live",
    notes: "Quarterly results.",
  },
  {
    name: "SEC EDGAR 10-K",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-K&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.95,
    storeBody: true,
    verified: "live",
    notes: "Annual results.",
  },
  {
    name: "SEC EDGAR Form 4",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.8,
    storeBody: true,
    verified: "live",
    notes:
      "Insider buys/sells. High volume and mostly noise; the scorer downweights routine grants.",
  },

  // --- Press release wires -------------------------------------------------
  // Company news originates here. When a newspaper reports a contract win, it
  // is usually reading the same release.
  {
    name: "GlobeNewswire - Public Companies",
    kind: "rss",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
    enabled: true,
    pollIntervalSec: 60,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes:
      "Carries non-English releases (Nordic issuers). Triage drops non-US-listed.",
  },
  {
    name: "GlobeNewswire - Earnings Releases",
    kind: "rss",
    url: "https://www.globenewswire.com/RssFeed/subjectcode/13-Earnings%20Releases%20and%20Operating%20Results",
    enabled: true,
    pollIntervalSec: 60,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes: "Subject-filtered subset; overlaps the public-companies feed.",
  },
  {
    name: "GlobeNewswire - M&A",
    kind: "rss",
    url: "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20and%20Acquisitions",
    enabled: true,
    pollIntervalSec: 60,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes: "Subject-filtered subset; overlaps the public-companies feed.",
  },
  {
    name: "Business Wire - Public Companies",
    kind: "rss",
    url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpRWA==",
    enabled: false,
    pollIntervalSec: 60,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "blocked",
    notes:
      "businesswire.com returned 403 to our probe. Ships disabled; enable on /sources once a real scan proves it.",
  },
  {
    name: "PR Newswire - All News Releases",
    kind: "rss",
    url: "https://www.prnewswire.com/rss/news-releases-list.rss",
    enabled: false,
    pollIntervalSec: 60,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "blocked",
    notes:
      "Cloudflare-fronted; probe blocked. Ships disabled pending a real scan.",
  },

  // --- Government / policy -------------------------------------------------
  // Where second-order signals originate: a tariff, a rule, a rate decision.
  {
    name: "Federal Register",
    kind: "api",
    url: "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&fields[]=title&fields[]=abstract&fields[]=html_url&fields[]=publication_date&fields[]=agencies&fields[]=type",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes:
      "JSON API, no key required. Rules, proposed rules, tariff and trade notices.",
  },
  {
    name: "Federal Reserve - Press Releases",
    kind: "rss",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes: "Rate decisions, enforcement actions, bank approvals.",
  },

  // --- Aggregated market news ----------------------------------------------
  // Headline-level breadth across outlets we cannot fetch directly.
  {
    name: "Finnhub - Market News",
    kind: "api",
    url: "https://finnhub.io/api/v1/news?category=general",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.7,
    storeBody: false,
    verified: "live",
    notes:
      "Requires MARKET_DATA_API_KEY. Headline + summary only; we never store third-party article bodies.",
  },
];
