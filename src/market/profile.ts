import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickerProfiles } from "@/db/schema";
import { fetchJson } from "@/sources/fetch";

/**
 * Company profile: industry, size, listing, website.
 *
 * Fetched from Finnhub's free profile endpoint on first view of a ticker page
 * and cached for 30 days — company facts change on the timescale of press
 * releases, not page loads. Missing key or a failed fetch degrade to "no
 * profile shown"; the page never depends on this.
 */

export type CompanyProfile = {
  symbol: string;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  website: string | null;
  ipoDate: string | null;
  marketCapM: number | null;
};

type FinnhubProfile = {
  finnhubIndustry?: string;
  exchange?: string;
  country?: string;
  weburl?: string;
  ipo?: string;
  marketCapitalization?: number;
};

const MAX_AGE_DAYS = 30;

export async function ensureProfile(
  symbol: string,
): Promise<CompanyProfile | null> {
  const database = db();

  const [cached] = await database
    .select()
    .from(tickerProfiles)
    .where(eq(tickerProfiles.symbol, symbol))
    .limit(1);

  const fresh =
    cached &&
    (Date.now() - cached.fetchedAt.getTime()) / 86_400_000 < MAX_AGE_DAYS;
  if (cached && fresh) return toProfile(cached);

  const key = process.env.MARKET_DATA_API_KEY;
  if (!key) return cached ? toProfile(cached) : null;

  try {
    const url = new URL("https://finnhub.io/api/v1/stock/profile2");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("token", key);
    const data = await fetchJson<FinnhubProfile>(url.toString(), {
      timeoutMs: 12_000,
    });

    // An empty object is Finnhub's "unknown symbol" answer. Cache nothing —
    // caching the absence would hide the profile for 30 days if the provider
    // simply had a bad moment.
    if (!data.finnhubIndustry && !data.exchange && !data.marketCapitalization) {
      return cached ? toProfile(cached) : null;
    }

    const row = {
      symbol,
      industry: data.finnhubIndustry ?? null,
      exchange: data.exchange ?? null,
      country: data.country ?? null,
      website: data.weburl ?? null,
      ipoDate: data.ipo || null,
      marketCapM:
        data.marketCapitalization === undefined
          ? null
          : data.marketCapitalization.toFixed(2),
      fetchedAt: new Date(),
    };

    await database
      .insert(tickerProfiles)
      .values(row)
      .onConflictDoUpdate({ target: tickerProfiles.symbol, set: row });

    return toProfile(row);
  } catch {
    return cached ? toProfile(cached) : null;
  }
}

function toProfile(row: {
  symbol: string;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  website: string | null;
  ipoDate: string | null;
  marketCapM: string | null;
}): CompanyProfile {
  return {
    symbol: row.symbol,
    industry: row.industry,
    exchange: row.exchange,
    country: row.country,
    website: row.website,
    ipoDate: row.ipoDate,
    marketCapM: row.marketCapM === null ? null : Number(row.marketCapM),
  };
}

/** "small cap" / "large cap" — the size bucket, for plain-language risk text. */
export function capBucket(marketCapM: number | null): {
  label: string;
  note: string;
} | null {
  if (marketCapM === null) return null;
  if (marketCapM < 300)
    return {
      label: "micro cap",
      note: "very small company — prices can move violently on little news and shares can be hard to trade",
    };
  if (marketCapM < 2_000)
    return {
      label: "small cap",
      note: "small company — bigger swings than the overall market are normal",
    };
  if (marketCapM < 10_000)
    return { label: "mid cap", note: "medium-sized company" };
  return { label: "large cap", note: "large, widely traded company" };
}
