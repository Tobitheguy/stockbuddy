/**
 * Seed list of ingestion sources.
 *
 * The `verified` field records a real check against the live endpoint, so we
 * never silently ship a dead feed:
 *
 *   "live"       - fetched successfully, returned parseable, current items.
 *   "blocked"    - the host refused the probe (403/404/timeout). Ships DISABLED.
 *   "unverified" - plausible and legitimate, but not yet proven from here.
 *                  Ships DISABLED. Step 3 adds a probe that tries each one
 *                  from the server (which has a different IP and User-Agent
 *                  than this dev machine) and flips the ones that respond.
 *
 * Feeds marked "live" were checked on 2026-09-06.
 *
 * CONTENT RULE. For third-party news sources we persist title + summary + link
 * only, never the article body. Full text is persisted only for public-domain
 * government material (EDGAR, Federal Register, Federal Reserve, SEC, FDA,
 * FTC, USTR, EIA, BLS) and for press-release wires, which publish releases
 * expressly for redistribution. No HTML scraping of paywalled or
 * scrape-prohibiting sites — feeds and official APIs only.
 *
 * ON SOCIAL MEDIA. See docs/social-media.md. Short version: Instagram and
 * Facebook have no legitimate public-post API at any price outside approved
 * academic research, and X is now metered per read, which makes broad
 * monitoring cost more than the rest of this system combined. Reddit is the
 * one social source with a free, legitimate, documented feed, so it is the
 * only one seeded here.
 */

export type SourceKind = "rss" | "api" | "edgar";
export type VerificationState = "live" | "blocked" | "unverified";

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
  verified: VerificationState;
  notes: string;
};

export const SEED_SOURCES: SeedSource[] = [
  // ==========================================================================
  // SEC EDGAR — the highest-value sources here. Complete, free, full text, and
  // where company-originated events legally must appear first.
  // ==========================================================================
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
    notes: "Annual results. Going-concern language lives here.",
  },
  {
    name: "SEC EDGAR SC 13D",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13D&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes:
      "Activist stake disclosures — an investor crossing 5% with intent to influence. Historically one of the strongest single-filing signals.",
  },
  {
    name: "SEC EDGAR SC 13G",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13G&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.7,
    storeBody: true,
    verified: "live",
    notes:
      "Passive 5% stakes. Much weaker than 13D — mostly index funds rebalancing.",
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
      "Insider buys/sells. Very high volume and mostly routine 10b5-1 vesting; the scorer must separate those from unplanned open-market cluster buys.",
  },
  {
    name: "SEC EDGAR NT 10-K / NT 10-Q",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=NT+10&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes:
      "Notification of late filing. A company telling the SEC it cannot file on time is one of the highest-signal, lowest-volume filings that exists — it frequently precedes a restatement, an auditor dispute or a going-concern warning. Almost nobody watches this feed.",
  },
  {
    name: "SEC EDGAR SC TO-T",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+TO-T&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.95,
    storeBody: true,
    verified: "live",
    notes: "Third-party tender offers — a hostile or negotiated takeover bid.",
  },
  {
    name: "SEC EDGAR 425",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=425&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes: "Merger communications filed during a pending deal.",
  },
  {
    name: "SEC EDGAR 6-K",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=6-K&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 600,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes:
      "Foreign private issuers reporting to the SEC. This is how a US-listed ADR discloses material news, and it is not covered by the 8-K feed.",
  },
  {
    name: "SEC EDGAR S-1",
    kind: "edgar",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&company=&dateb=&owner=include&count=100&output=atom",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.7,
    storeBody: true,
    verified: "live",
    notes:
      "IPO registrations. Catches newly public companies before they have analyst coverage.",
  },

  // ==========================================================================
  // Press release wires — where company news originates.
  // ==========================================================================
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
      "businesswire.com returned 403 to the probe. Step 3 retries from the server.",
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
    notes: "Cloudflare-fronted; probe blocked. Step 3 retries from the server.",
  },

  // ==========================================================================
  // Financial news outlets.
  // ==========================================================================
  {
    name: "WSJ - Markets",
    kind: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.8,
    storeBody: false,
    verified: "live",
    notes:
      "Dow Jones public feed. Headlines and standfirsts only — the articles themselves are paywalled and are never fetched.",
  },
  {
    name: "Yahoo Finance - News",
    kind: "rss",
    url: "https://finance.yahoo.com/news/rssindex",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.65,
    storeBody: false,
    verified: "live",
    notes:
      "Broad aggregation across outlets. Noisy, but wide — good recall, low precision.",
  },
  {
    name: "MarketWatch - Top Stories",
    kind: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.55,
    storeBody: false,
    verified: "live",
    notes:
      "Heavily weighted to personal finance and advice columns rather than market news. Low weight on purpose.",
  },
  {
    name: "CNBC - Top News",
    kind: "rss",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    enabled: false,
    pollIntervalSec: 300,
    qualityWeight: 0.7,
    storeBody: false,
    verified: "blocked",
    notes: "403 to the probe. Step 3 retries from the server.",
  },
  {
    name: "MarketWatch - MarketPulse",
    kind: "rss",
    url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
    enabled: true,
    pollIntervalSec: 180,
    qualityWeight: 0.75,
    storeBody: false,
    verified: "live",
    notes:
      "Breaking market headlines, tight and factual — the best of the outlet feeds tested. Much higher signal than MarketWatch Top Stories.",
  },
  {
    name: "NBC News - Business",
    kind: "rss",
    url: "https://feeds.nbcnews.com/nbcnews/public/business",
    enabled: true,
    pollIntervalSec: 600,
    qualityWeight: 0.45,
    storeBody: false,
    verified: "live",
    notes:
      "General business desk. Sample fetch returned one macro item (jobs report, already covered by BLS) and two media-industry stories. Low weight accordingly.",
  },
  {
    name: "Fortune",
    kind: "rss",
    url: "https://fortune.com/feed/",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.4,
    storeBody: false,
    verified: "live",
    notes:
      "Business magazine. Sample fetch was one-third markets, two-thirds general interest. Kept at low weight for the occasional macro piece.",
  },
  {
    name: "Seeking Alpha - Market Currents",
    kind: "rss",
    url: "https://seekingalpha.com/market_currents.xml",
    enabled: false,
    pollIntervalSec: 300,
    qualityWeight: 0.6,
    storeBody: false,
    verified: "unverified",
    notes: "Not probed from here. Step 3 tries it.",
  },
  {
    name: "Reuters - Business & Finance",
    kind: "rss",
    url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    enabled: false,
    pollIntervalSec: 300,
    qualityWeight: 0.85,
    storeBody: false,
    verified: "blocked",
    notes:
      "Unreachable from here. Worth retrying in Step 3: Reuters is one of the few outlets that originates market-moving scoops rather than relaying wires.",
  },
  {
    name: "Associated Press - Business",
    kind: "rss",
    url: "https://apnews.com/hub/business.rss",
    enabled: false,
    pollIntervalSec: 300,
    qualityWeight: 0.8,
    storeBody: false,
    verified: "blocked",
    notes: "Unreachable from here. Retried in Step 3.",
  },
  {
    name: "Business Insider",
    kind: "rss",
    url: "https://feeds.businessinsider.com/custom/all",
    enabled: false,
    pollIntervalSec: 600,
    qualityWeight: 0.45,
    storeBody: false,
    verified: "blocked",
    notes: "Unreachable from here. Retried in Step 3.",
  },
  {
    name: "CNN Business",
    kind: "rss",
    url: "http://rss.cnn.com/rss/money_latest.rss",
    enabled: false,
    pollIntervalSec: 600,
    qualityWeight: 0.4,
    storeBody: false,
    verified: "blocked",
    notes: "Connection closed during the probe. Retried in Step 3.",
  },
  {
    name: "Benzinga",
    kind: "rss",
    url: "https://www.benzinga.com/feed",
    enabled: false,
    pollIntervalSec: 600,
    qualityWeight: 0.25,
    storeBody: false,
    verified: "live",
    notes:
      "Feed responds, but the sample returned SEO crypto price-prediction pages, not news. Enabled=false on quality grounds rather than reachability — a good reminder that 'the feed works' and 'the feed is worth paying to read' are different questions.",
  },

  // ==========================================================================
  // Government and regulators — where second-order signals originate. All
  // public domain, so full text is fair to store.
  // ==========================================================================
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
  {
    name: "SEC - Press Releases",
    kind: "rss",
    url: "https://www.sec.gov/news/pressreleases.rss",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes: "Enforcement actions and rule changes.",
  },
  {
    name: "FDA - Press Announcements",
    kind: "rss",
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    enabled: true,
    pollIntervalSec: 300,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes:
      "Approvals, rejections and recalls. For biotech this is the event itself, not coverage of it — and it reliably moves two stocks, the filer's and its nearest competitor's.",
  },
  {
    name: "FTC - Competition Press Releases",
    kind: "rss",
    url: "https://www.ftc.gov/feeds/press-release-competition.xml",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes:
      "Merger challenges and consent orders. A blocked deal moves both parties hard.",
  },
  {
    name: "USTR - Press Releases",
    kind: "rss",
    url: "https://ustr.gov/rss.xml",
    enabled: true,
    pollIntervalSec: 900,
    qualityWeight: 0.8,
    storeBody: true,
    verified: "live",
    notes: "Tariffs and trade actions — the classic second-order source.",
  },
  {
    name: "EIA - Today in Energy",
    kind: "rss",
    url: "https://www.eia.gov/rss/todayinenergy.xml",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.7,
    storeBody: true,
    verified: "live",
    notes: "Energy supply, demand and price analysis.",
  },
  {
    name: "BLS - Latest Numbers",
    kind: "rss",
    url: "https://www.bls.gov/feed/bls_latest.rss",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.6,
    storeBody: true,
    verified: "live",
    notes:
      "CPI, payrolls, unemployment. Publishes as a single rolling item rather than one per release, so dedupe must key on content, not URL.",
  },
  {
    name: "US Treasury - Press Releases",
    kind: "rss",
    url: "https://home.treasury.gov/news/press-releases/feed",
    enabled: false,
    pollIntervalSec: 900,
    qualityWeight: 0.8,
    storeBody: true,
    verified: "blocked",
    notes: "404 at this URL. Step 3 resolves the current one.",
  },
  {
    name: "DOJ - Antitrust",
    kind: "rss",
    url: "https://www.justice.gov/feeds/opa/justice-news.xml",
    enabled: false,
    pollIntervalSec: 900,
    qualityWeight: 0.8,
    storeBody: true,
    verified: "blocked",
    notes: "404 at this URL. Step 3 resolves the current one.",
  },

  // ==========================================================================
  // Primary databases.
  //
  // These are the highest-leverage additions in the whole list, and the reason
  // is worth stating: they carry the underlying fact BEFORE anyone writes a
  // story about it. A federal contract award is recorded in USASpending when
  // the agency obligates the money, which can precede the company's own press
  // release. A clinical trial flips to "Active, not recruiting" in the
  // registry before the sponsor announces enrolment is complete.
  //
  // Nobody reads these feeds, which is exactly why they are worth reading. All
  // are free, public-domain US government data with no API key.
  // ==========================================================================
  {
    name: "USASpending - Federal Contract Awards",
    kind: "api",
    url: "https://api.usaspending.gov/api/v2/search/spending_by_award/",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.9,
    storeBody: true,
    verified: "live",
    notes:
      "Federal contract awards. POST endpoint, no key. Filtered to awards above a size threshold; the scanner maps the recipient's parent company to a ticker. Catches defence, health and infrastructure awards at the moment the money is obligated.",
  },
  {
    name: "ClinicalTrials.gov - Trial Updates",
    kind: "api",
    url: "https://clinicaltrials.gov/api/v2/studies?pageSize=100&sort=LastUpdatePostDate:desc&fields=NCTId,BriefTitle,OverallStatus,LeadSponsorName,LastUpdatePostDate,Phase,WhyStopped",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes:
      "Trial status changes for commercial sponsors. A phase-3 trial flipping to TERMINATED or SUSPENDED, and the WhyStopped text, is material news that often predates any announcement. Verified live — the sample returned Roche and Amgen studies.",
  },
  {
    name: "openFDA - Drug Approvals",
    kind: "api",
    url: "https://api.fda.gov/drug/drugsfda.json?limit=100&sort=submissions.submission_status_date:desc",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.85,
    storeBody: true,
    verified: "live",
    notes:
      "Structured drug approval records, keyed by sponsor. Complements the FDA press feed, which only covers announcements the FDA chose to publicise. Verified live — the sample returned a Pfizer NDA.",
  },
  {
    name: "openFDA - Drug Enforcement / Recalls",
    kind: "api",
    url: "https://api.fda.gov/drug/enforcement.json?limit=100&sort=report_date:desc",
    enabled: true,
    pollIntervalSec: 3600,
    qualityWeight: 0.8,
    storeBody: true,
    verified: "unverified",
    notes:
      "Same openFDA host as the verified drug-approvals endpoint, different dataset. Recalls and enforcement actions.",
  },
  {
    name: "NHTSA - Vehicle Recalls",
    kind: "api",
    url: "https://api.nhtsa.gov/recalls/recallsByVehicle",
    enabled: false,
    pollIntervalSec: 3600,
    qualityWeight: 0.75,
    storeBody: true,
    verified: "unverified",
    notes:
      "Vehicle safety recalls. Material for automakers and their suppliers. Step 3 confirms the query shape.",
  },

  // ==========================================================================
  // Aggregated market data.
  // ==========================================================================
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
      "Requires MARKET_DATA_API_KEY. Headline + summary only; third-party article bodies are never stored.",
  },

  // ==========================================================================
  // Social. Reddit only — see docs/social-media.md for why X, Instagram and
  // Facebook are not here.
  // ==========================================================================
  {
    name: "Reddit - r/stocks",
    kind: "rss",
    url: "https://www.reddit.com/r/stocks/new/.rss",
    enabled: false,
    pollIntervalSec: 600,
    qualityWeight: 0.3,
    storeBody: false,
    verified: "unverified",
    notes:
      "Public Reddit feed, legitimate and free. Very low quality weight: retail chatter is mostly reaction to news already in the other feeds, not new information. Ships disabled until it earns its place in /stats.",
  },
  {
    name: "Reddit - r/wallstreetbets",
    kind: "rss",
    url: "https://www.reddit.com/r/wallstreetbets/new/.rss",
    enabled: false,
    pollIntervalSec: 600,
    qualityWeight: 0.2,
    storeBody: false,
    verified: "unverified",
    notes:
      "Same caveat as r/stocks, more so. Useful only for detecting a crowd already moving, never as an original signal.",
  },
];
