import { fetchRss } from "./rss";
import { secRateLimited } from "./fetch";
import type { FetchResult } from "./types";

/**
 * SEC EDGAR adapter.
 *
 * EDGAR's "getcurrent" endpoint is an Atom feed, so the generic RSS adapter
 * does the parsing. This layer adds the two things EDGAR specifically
 * requires — the identifying User-Agent and the request-rate gate — plus
 * extraction of the company name and CIK, which are buried in the entry title.
 */

/**
 * EDGAR entry titles look exactly like this:
 *
 *   "8-K - VIASAT INC (0000797721) (Filer)"
 *   "4 - Smith John A (0001234567) (Reporting)"
 *
 * The company name is the strongest ticker-matching hint EDGAR gives us, so it
 * is worth pulling out rather than leaving the model to parse the string.
 */
const EDGAR_TITLE_RE = /^(?<form>[^-]+?)\s*-\s*(?<name>.+?)\s*\((?<cik>\d{4,10})\)/;

export type EdgarTitleParts = {
  formType: string | null;
  companyName: string | null;
  cik: string | null;
};

export function parseEdgarTitle(title: string): EdgarTitleParts {
  const m = EDGAR_TITLE_RE.exec(title.trim());
  if (!m?.groups) {
    return { formType: null, companyName: null, cik: null };
  }
  return {
    formType: m.groups.form.trim() || null,
    companyName: m.groups.name.trim() || null,
    // CIKs are zero-padded to 10 digits everywhere else in EDGAR; normalising
    // here means a lookup never misses because of leading zeros.
    cik: m.groups.cik.padStart(10, "0"),
  };
}

export async function fetchEdgar(
  url: string,
  opts: { storeBody: boolean },
): Promise<FetchResult> {
  const result = await secRateLimited(() =>
    fetchRss(url, { storeBody: opts.storeBody, sec: true }),
  );

  // Rewrite the summary so the company name and CIK are explicit rather than
  // encoded in the title string. The scorer reads the summary, and giving it
  // "Filed by: VIASAT INC (CIK 0000797721)" beats making it re-derive that.
  const items = result.items.map((item) => {
    const { formType, companyName, cik } = parseEdgarTitle(item.title);
    if (!companyName) return item;

    const prefix = `Filed by: ${companyName}${cik ? ` (CIK ${cik})` : ""}${
      formType ? `. Form type: ${formType}` : ""
    }.`;
    return {
      ...item,
      summary: item.summary ? `${prefix} ${item.summary}` : prefix,
    };
  });

  const unparsed = items.length - items.filter((i) =>
    parseEdgarTitle(i.title).companyName,
  ).length;

  const warnings = [...result.warnings];
  if (unparsed > 0) {
    warnings.push(`${unparsed} EDGAR title(s) did not match the expected format`);
  }

  return { items, warnings };
}
