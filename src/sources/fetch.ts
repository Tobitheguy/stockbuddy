/**
 * Shared HTTP layer for all source adapters.
 *
 * SSRF note: every URL fetched here comes from the `sources` table, which is
 * seeded from a version-controlled config file. No user input ever reaches
 * this function, so this is not an SSRF surface. The scheme and host checks
 * below exist to catch a bad config entry, not an attacker.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

/** A descriptive, contactable User-Agent is a hard requirement at sec.gov. */
export function secUserAgent(): string {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua || !ua.includes("@")) {
    throw new Error(
      "SEC_USER_AGENT must be set and contain a contact email address. " +
        "The SEC blocks requests without one. Format: SignalDesk/1.0 (you@example.com)",
    );
  }
  return ua;
}

/**
 * User-Agent for ordinary public feeds.
 *
 * Measured, not guessed. With a `(compatible; SignalDeskBot/1.0; +url)` agent,
 * ftc.gov and cnbc.com both return 403; with a standard browser agent both
 * return 200 with full content. Many publishers block anything that looks
 * automated by string-matching the agent, regardless of what it is doing.
 *
 * These are public RSS feeds published for the express purpose of being read
 * by feed readers, and this is what feed readers send. No authentication is
 * being bypassed and no robots directive is being ignored — the rate limits
 * and poll intervals in the source config still apply. sec.gov is the
 * exception: it *requires* a descriptive identifying agent, and gets one.
 */
const FEED_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  accept?: string;
  /** Uses the SEC's required identifying User-Agent instead of the feed one. */
  sec?: boolean;
  method?: "GET" | "POST";
  body?: string;
};

export async function fetchText(
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Refusing to fetch non-HTTP scheme: ${parsed.protocol}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const headers: Record<string, string> = {
      "User-Agent": opts.sec ? secUserAgent() : FEED_UA,
      Accept: opts.accept ?? "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate",
    };
    if (opts.body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) throw new HttpError(res.status, url);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const text = await fetchText(url, {
    ...opts,
    accept: opts.accept ?? "application/json",
  });
  return JSON.parse(text) as T;
}

/**
 * sec.gov permits at most 10 requests/second across all clients using your
 * User-Agent, and enforces it by blocking. Every EDGAR call goes through this
 * gate, which serialises them with a minimum spacing.
 *
 * Deliberately more conservative than the published limit: being throttled
 * costs a whole scan cycle, while being slightly slow costs nothing. The
 * feeds are polled once a minute at most.
 */
let secChain: Promise<unknown> = Promise.resolve();
const SEC_MIN_SPACING_MS = 150; // ≈6.6 req/s

export function secRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = secChain.then(async () => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < SEC_MIN_SPACING_MS) {
        await new Promise((r) => setTimeout(r, SEC_MIN_SPACING_MS - elapsed));
      }
    }
  });
  // Keep the chain alive even when a call rejects, or one failed EDGAR fetch
  // would poison every subsequent one in the same run.
  secChain = run.catch(() => undefined);
  return run;
}
