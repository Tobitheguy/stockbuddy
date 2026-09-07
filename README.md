# Signal Desk

A private stock-catalyst research tool for one user.

Signal Desk polls a curated list of high-signal, ToS-compliant sources every
few minutes, links each item to publicly traded US companies, scores it as a
potential catalyst with Claude, and shows a ranked feed on a dashboard.

**It surfaces signals for research. It never places trades.** Every signal
shows its source link and the reasoning behind it. There are no buy or sell
buttons anywhere in the product.

---

## What it does

| | |
|---|---|
| **Scanner** | Fetches every enabled source on its own interval, normalizes to items, dedupes by URL hash and near-duplicate title. One failing source never aborts the run. |
| **Scorer** | Two-stage Claude pipeline. Stage A triage (Haiku 4.5) answers "is this about a US-listed company or a tradable sector?" cheaply. Stage B (Opus 5) scores the survivors into structured JSON: tickers, event type, direction, magnitude, confidence, horizon, rationale. |
| **Dashboard** | Ranked signal feed with filters, a per-ticker page, a watchlist, per-source health, and a stats page. |
| **Outcomes** | Records the price at signal time and the closes at +1, +5 and +20 trading days, then reports hit rate by event type, source and confidence bucket. This is how you learn which signal types are worth acting on. |

### Scope of V1

Deliberately excluded: broker integration, auto-trading, portfolio P&L, social
sentiment, push alerts, multi-user, options, non-US markets, real auth.

---

## Honest limits

Worth understanding before relying on this.

- **It will not beat algorithms on speed.** An 8-K hits EDGAR and is priced in
  under a second. A 60-second poll is 60 seconds late. The edge this tool is
  built for is *interpretation* — connecting a tariff or a contract award to
  the companies it affects that are not named in the headline.
- **Coverage is good but not total.** Roughly 85–90% of hard, company-originated
  catalysts (filings, wires, regulatory actions) are reachable. Paywalled scoops
  (Bloomberg, WSJ, Reuters terminal) are not, at any price short of a licence.
- **It will be confidently wrong sometimes.** Nobody can tell you in advance how
  often. That is what `/stats` and the outcome tracking are for — treat the
  first month as calibration, not as a trading system.

---

## Setup

Steps 1–5 need accounts. Nothing in the repo contains a key; everything reads
from the environment and is built to run the moment the values are pasted in.

```bash
cp .env.example .env.local
```

Then fill in each value below.

### 1. Neon Postgres — `DATABASE_URL`

1. Sign up at [neon.tech](https://neon.tech) (free tier is enough for V1).
2. Create a project. Pick **US West (Oregon)** to sit close to Vercel's
   default function region.
3. Open **Connection Details** and copy the **Pooled connection** string — the
   host contains `-pooler`. The serverless driver needs the pooled endpoint.
4. Paste into `DATABASE_URL`.

### 2. Anthropic — `ANTHROPIC_API_KEY`

1. Sign up at [console.anthropic.com](https://console.anthropic.com).
2. Add a payment method and a small credit balance.
3. **API Keys → Create Key**, copy it into `ANTHROPIC_API_KEY`.
4. Set `DAILY_LLM_BUDGET_USD`. Start at `2.00`. Processing halts and logs when
   the day's recorded spend exceeds it.

### 3. Market data — `MARKET_DATA_API_KEY`

V1 uses **Finnhub**. The choice, and the reason, checked 2026-09-06:

| Provider | Free tier | Verdict |
|---|---|---|
| **Finnhub** | 60 requests/min | **Chosen.** Enough headroom for the daily price backfill across pending outcomes plus the weekly ticker sync. |
| Polygon | ~5 requests/min | Too tight. The outcomes job alone would take hours and risk missing the window. |

1. Sign up at [finnhub.io](https://finnhub.io).
2. Copy the key from the dashboard into `MARKET_DATA_API_KEY`.
3. Leave `MARKET_DATA_PROVIDER=finnhub`.

### 4. Secrets — `CRON_SECRET`, `SESSION_SECRET`

Generate two independent random values:

```bash
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # SESSION_SECRET
```

On Windows without openssl:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Set `ADMIN_EMAIL` to the single email address allowed to sign in.

### 5. SEC EDGAR — `SEC_USER_AGENT`

No signup, but the SEC **requires** a descriptive User-Agent containing a real
contact address and rate-limits to 10 requests/second. Requests without it are
blocked. Put your own email in:

```
SEC_USER_AGENT=SignalDesk/1.0 (you@example.com)
```

### 6. Vercel — `APP_URL` and cron

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Add every variable from `.env.example` under **Settings → Environment Variables**.
3. Deploy, then set `APP_URL` to the production URL (no trailing slash) and redeploy.

**Cron requires attention.** Checked 2026-09-06:

| Plan | Cron capability |
|---|---|
| **Hobby (free)** | Once per day, hour-level precision only. Any expression firing more than once a day **fails at deploy time**. |
| **Pro (~$20/mo)** | Per-minute cadence and per-minute precision. |

So there are two paths, and this is a real decision, not a formality:

- **Vercel Pro** — `vercel.json` crons work as written. Simplest.
- **Stay on Hobby + external scheduler** — free, one more moving part. Point
  [cron-job.org](https://cron-job.org) or a GitHub Actions schedule at
  `POST {APP_URL}/api/scan` with header `Authorization: Bearer $CRON_SECRET`.
  Note GitHub Actions cron is best-effort and can drift 5–15 minutes under load.

---

## Sources

The seed list lives in [`src/config/source-seed.ts`](src/config/source-seed.ts).
Every entry records whether it was verified against the live endpoint.

**Verified live on 2026-09-06:** SEC EDGAR (8-K, 10-Q, 10-K, Form 4),
GlobeNewswire (public companies, earnings, M&A), Federal Register API,
Federal Reserve press releases, Finnhub market news.

**Ship disabled, pending proof:** Business Wire and PR Newswire both returned
403 to the verification probe. They may work from a server with a browser-like
User-Agent, but they are not enabled on faith — turn them on from `/sources`
once a real scan succeeds.

Coverage grows by adding entries to that config, not by crawling.

---

## Development

```bash
npm install
npm run dev
```

Steps 1–4 are built against `fixtures/` and need no keys:

- `fixtures/raw/` — real feed payloads captured live, for testing the parsers.
- `fixtures/items.json` — 23 normalized items. Eleven are real; twelve are
  authored to cover event types and second-order reasoning the capture did not
  contain. Every enabled source has at least one fixture. 21 items carry an
  `expected` block that doubles as a machine-checkable scorer assertion —
  including the contract-win injection test (`fx-012`), the tariff
  split-direction test (`fx-013`), and the beat-and-lower test (`fx-023`),
  which is the most common way a headline-reading scorer gets direction
  exactly backwards.

```bash
npm run build     # must pass before every PR
npm run lint
npm run test      # unit tests, incl. recency decay and score weights
```

---

## Security notes

- No secret is prefixed `NEXT_PUBLIC_`, so none reach the client bundle.
- `/api/scan`, `/api/process` and `/api/outcomes` require
  `Authorization: Bearer $CRON_SECRET` and return 401 without it.
- The dashboard requires an HMAC-signed session cookie; the login route is
  rate-limited.
- Feed URLs come only from the server-side config, never from user input, so
  the fetcher is not an SSRF surface.
