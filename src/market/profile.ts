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
  description: string | null;
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
  description?: string | null;
}): CompanyProfile {
  return {
    symbol: row.symbol,
    industry: row.industry,
    exchange: row.exchange,
    country: row.country,
    website: row.website,
    ipoDate: row.ipoDate,
    marketCapM: row.marketCapM === null ? null : Number(row.marketCapM),
    description: row.description ?? null,
  };
}

/**
 * Two-to-three sentence description of what the company does, in language a
 * non-expert can follow. Written once by Haiku, cached forever in the
 * profiles table — roughly a tenth of a cent per company, spent only when the
 * user actually opens that company's page.
 *
 * Facts-only by instruction: the description must never editorialise about
 * the stock, because it sits directly above signals that do make claims and
 * the two kinds of text must not blur.
 */
export async function ensureDescription(
  symbol: string,
  companyName: string,
  profile: CompanyProfile | null,
): Promise<string | null> {
  if (profile?.description) return profile.description;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system:
        "Write 2-3 short sentences explaining what a company does, for " +
        "someone with no finance background. Plain words, no jargon, no " +
        "opinions about the stock, no numbers you are not sure of. Just: " +
        "what they make or do, who pays them, and how they earn money.",
      messages: [
        {
          role: "user",
          content:
            `Company: ${companyName} (ticker ${symbol}` +
            (profile?.industry ? `, industry: ${profile.industry}` : "") +
            `)`,
        },
      ],
    });

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      // The model sometimes leads with a markdown heading repeating the
      // company name; the page already shows the name, so strip any heading
      // lines and inline markdown markers.
      .replace(/^#{1,6} .*$/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 30) return null;

    await db()
      .insert(tickerProfiles)
      .values({ symbol, description: text })
      .onConflictDoUpdate({
        target: tickerProfiles.symbol,
        set: { description: text },
      });
    return text;
  } catch {
    return null;
  }
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
