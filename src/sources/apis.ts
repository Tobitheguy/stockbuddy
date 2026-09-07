import { fetchJson } from "./fetch";
import {
  cap,
  MAX_BODY_CHARS,
  MAX_SUMMARY_CHARS,
  parseDate,
  stripHtml,
  type FetchResult,
  type RawItem,
} from "./types";

/**
 * JSON API adapters.
 *
 * Each of these speaks a different shape, so they are hand-written rather than
 * generalised. Dispatch is by hostname in `fetchApi` at the bottom.
 */

// ---------------------------------------------------------------------------
// Federal Register
// ---------------------------------------------------------------------------

type FederalRegisterDoc = {
  title?: string;
  abstract?: string | null;
  html_url?: string;
  publication_date?: string;
  type?: string;
  agencies?: Array<{ name?: string }>;
};

function federalRegister(json: unknown): FetchResult {
  const results = (json as { results?: FederalRegisterDoc[] })?.results ?? [];
  const items: RawItem[] = [];

  for (const doc of results) {
    if (!doc.title || !doc.html_url) continue;
    const agencies = (doc.agencies ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(", ");
    // The agency and document type are the strongest hints about whether a
    // notice is economically material, so they go in the summary rather than
    // being dropped.
    const parts = [
      doc.type ? `Type: ${doc.type}.` : "",
      agencies ? `Agency: ${agencies}.` : "",
      doc.abstract ?? "",
    ].filter(Boolean);

    items.push({
      url: doc.html_url,
      title: doc.title,
      summary: cap(parts.join(" ").trim(), MAX_SUMMARY_CHARS) || null,
      body: doc.abstract ? cap(doc.abstract, MAX_BODY_CHARS) : null,
      publishedAt: parseDate(doc.publication_date).date,
    });
  }
  return { items, warnings: [] };
}

// ---------------------------------------------------------------------------
// ClinicalTrials.gov v2
// ---------------------------------------------------------------------------

type CtStudy = {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: {
      overallStatus?: string;
      whyStopped?: string;
      lastUpdatePostDateStruct?: { date?: string };
    };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    designModule?: { phases?: string[] };
  };
};

/**
 * Statuses that are genuinely newsworthy. A trial quietly flipping to
 * TERMINATED is material and usually predates any announcement; one flipping
 * to RECRUITING is routine and would flood the feed.
 */
const CT_MATERIAL_STATUS = new Set([
  "TERMINATED",
  "SUSPENDED",
  "WITHDRAWN",
  "COMPLETED",
  "ACTIVE_NOT_RECRUITING",
]);

function clinicalTrials(json: unknown): FetchResult {
  const studies = (json as { studies?: CtStudy[] })?.studies ?? [];
  const items: RawItem[] = [];
  let skipped = 0;

  for (const s of studies) {
    const p = s.protocolSection;
    const id = p?.identificationModule;
    const st = p?.statusModule;
    if (!id?.nctId || !id.briefTitle) continue;

    const status = (st?.overallStatus ?? "").toUpperCase();
    if (!CT_MATERIAL_STATUS.has(status)) {
      skipped++;
      continue;
    }

    const sponsor = p?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "Unknown sponsor";
    const phases = (p?.designModule?.phases ?? []).join(", ");
    const why = st?.whyStopped;

    const summary = [
      `Sponsor: ${sponsor}.`,
      `Status: ${status}.`,
      phases ? `Phase: ${phases}.` : "",
      // The reason a sponsor stopped a trial is the single most valuable
      // field in this feed.
      why ? `Reason given: ${why}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    items.push({
      url: `https://clinicaltrials.gov/study/${id.nctId}`,
      title: `${status.replace(/_/g, " ")}: ${id.briefTitle}`,
      summary: cap(summary, MAX_SUMMARY_CHARS),
      body: cap(summary, MAX_BODY_CHARS),
      publishedAt: parseDate(st?.lastUpdatePostDateStruct?.date).date,
    });
  }

  return {
    items,
    warnings: skipped
      ? [`${skipped} trial update(s) skipped as routine status changes`]
      : [],
  };
}

// ---------------------------------------------------------------------------
// openFDA
// ---------------------------------------------------------------------------

type OpenFdaDrug = {
  sponsor_name?: string;
  application_number?: string;
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  products?: Array<{ brand_name?: string; dosage_form?: string }>;
  submissions?: Array<{
    submission_type?: string;
    submission_status?: string;
    submission_status_date?: string;
    submission_class_code_description?: string;
  }>;
};

function openFdaDrugs(json: unknown): FetchResult {
  const results = (json as { results?: OpenFdaDrug[] })?.results ?? [];
  const items: RawItem[] = [];

  for (const r of results) {
    if (!r.application_number || !r.sponsor_name) continue;

    // Take the most recent submission — that is the event.
    const subs = [...(r.submissions ?? [])].sort((a, b) =>
      (b.submission_status_date ?? "").localeCompare(
        a.submission_status_date ?? "",
      ),
    );
    const latest = subs[0];
    if (!latest?.submission_status_date) continue;

    const brand =
      r.products?.[0]?.brand_name ??
      r.openfda?.brand_name?.[0] ??
      r.openfda?.generic_name?.[0] ??
      r.application_number;

    const summary = [
      `Sponsor: ${r.sponsor_name}.`,
      `Application: ${r.application_number}.`,
      latest.submission_type ? `Submission: ${latest.submission_type}.` : "",
      latest.submission_status ? `Status: ${latest.submission_status}.` : "",
      latest.submission_class_code_description
        ? `Class: ${latest.submission_class_code_description}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    items.push({
      // openFDA has no per-record permalink; Drugs@FDA is the canonical view.
      url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${encodeURIComponent(
        r.application_number.replace(/^\D+/, ""),
      )}`,
      title: `${latest.submission_status ?? "Update"}: ${brand} (${r.sponsor_name})`,
      summary: cap(summary, MAX_SUMMARY_CHARS),
      body: cap(summary, MAX_BODY_CHARS),
      publishedAt: parseDate(
        // openFDA dates are YYYYMMDD with no separators.
        latest.submission_status_date.replace(
          /^(\d{4})(\d{2})(\d{2})$/,
          "$1-$2-$3",
        ),
      ).date,
    });
  }
  return { items, warnings: [] };
}

// ---------------------------------------------------------------------------
// Finnhub market news
// ---------------------------------------------------------------------------

type FinnhubNews = {
  headline?: string;
  summary?: string;
  url?: string;
  datetime?: number;
  source?: string;
  related?: string;
};

function finnhub(json: unknown): FetchResult {
  const rows = Array.isArray(json) ? (json as FinnhubNews[]) : [];
  const items: RawItem[] = [];

  for (const n of rows) {
    if (!n.headline || !n.url) continue;
    const related = n.related?.trim();
    items.push({
      url: n.url,
      title: stripHtml(n.headline),
      summary: cap(
        [
          n.source ? `Source: ${n.source}.` : "",
          related ? `Tickers: ${related}.` : "",
          stripHtml(n.summary),
        ]
          .filter(Boolean)
          .join(" "),
        MAX_SUMMARY_CHARS,
      ),
      // Third-party article body is never stored.
      body: null,
      publishedAt: parseDate(n.datetime).date,
    });
  }
  return { items, warnings: [] };
}

// ---------------------------------------------------------------------------
// USASpending — federal contract awards
// ---------------------------------------------------------------------------

type UsaSpendingAward = Record<string, unknown>;

/** Awards below this are too small to move a listed company. */
const MIN_AWARD_USD = 25_000_000;

function usaSpendingBody(): string {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return JSON.stringify({
    filters: {
      // A=BPA call, B=purchase order, C=delivery order, D=definitive contract.
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: iso(start), end_date: iso(end) }],
      award_amount: [{ lower_bound: MIN_AWARD_USD }],
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Awarding Agency",
      "Awarding Sub Agency",
      "Start Date",
      // The date the award was actually acted on. "Start Date" is the period
      // of performance start, which on a renewal can be decades old — one
      // award in the live data carried 1978 and decayed to nothing the moment
      // it was ingested.
      "Last Modified Date",
      "Description",
    ],
    page: 1,
    limit: 100,
    sort: "Award Amount",
    order: "desc",
  });
}

/**
 * When this award became news.
 *
 * The query filters to actions in the last seven days, so by construction
 * every result IS recent — but "Start Date" is the period-of-performance
 * start, which on a renewed contract can be decades earlier. Using it made
 * genuinely fresh multi-billion-dollar awards arrive pre-decayed to zero, and
 * put a 1978 timestamp in the database.
 *
 * Prefer the modification date; fall back to the start date only when it is
 * plausibly recent; otherwise treat it as new, which the query guarantees.
 */
function awardDate(a: UsaSpendingAward): Date {
  const record = a as Record<string, unknown>;
  const modified = parseDate(String(record["Last Modified Date"] ?? "")).date;
  const windowStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (modified && modified.getTime() > windowStart) return modified;

  const start = parseDate(String(record["Start Date"] ?? "")).date;
  if (start && start.getTime() > windowStart) return start;

  return new Date();
}

function usaSpending(json: unknown): FetchResult {
  const results = (json as { results?: UsaSpendingAward[] })?.results ?? [];
  const items: RawItem[] = [];

  for (const a of results) {
    const recipient = String(a["Recipient Name"] ?? "").trim();
    const awardId = String(a["Award ID"] ?? "").trim();
    if (!recipient || !awardId) continue;

    const amount = Number(a["Award Amount"] ?? 0);
    const agency = String(a["Awarding Agency"] ?? "");
    const description = String(a["Description"] ?? "");
    const amountLabel =
      amount >= 1e9
        ? `$${(amount / 1e9).toFixed(2)} billion`
        : `$${(amount / 1e6).toFixed(1)} million`;

    const summary = [
      `Recipient: ${recipient}.`,
      `Award amount: ${amountLabel}.`,
      agency ? `Awarding agency: ${agency}.` : "",
      description ? `Description: ${description}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    items.push({
      url: `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}`,
      title: `${recipient} awarded ${amountLabel} federal contract`,
      summary: cap(summary, MAX_SUMMARY_CHARS),
      body: cap(summary, MAX_BODY_CHARS),
      publishedAt: awardDate(a),
    });
  }
  return { items, warnings: [] };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function fetchApi(url: string): Promise<FetchResult> {
  const host = new URL(url).hostname;

  if (host.endsWith("federalregister.gov")) {
    return federalRegister(await fetchJson(url));
  }
  if (host.endsWith("clinicaltrials.gov")) {
    return clinicalTrials(await fetchJson(url));
  }
  if (host.endsWith("api.fda.gov")) {
    return openFdaDrugs(await fetchJson(url));
  }
  if (host.endsWith("usaspending.gov")) {
    return usaSpending(
      await fetchJson(url, { method: "POST", body: usaSpendingBody() }),
    );
  }
  if (host.endsWith("finnhub.io")) {
    const key = process.env.MARKET_DATA_API_KEY;
    if (!key) {
      throw new Error(
        "MARKET_DATA_API_KEY is not set; the Finnhub source cannot be fetched.",
      );
    }
    const withKey = new URL(url);
    withKey.searchParams.set("token", key);
    return finnhub(await fetchJson(withKey.toString()));
  }

  throw new Error(`No API adapter is registered for host ${host}`);
}
