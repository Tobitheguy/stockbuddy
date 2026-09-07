# Progress

Living status doc. Updated at every checkpoint.

**Repo:** https://github.com/Tobitheguy/stockbuddy
**Current checkpoint:** CP1 — awaiting review

---

## Checkpoints

| | Checkpoint | Status |
|---|---|---|
| CP0 | Repo, env example, README setup, fixtures | **Approved** |
| CP1 | Shell + design tokens rendering | **Awaiting approval** |
| CP2 | Schema, migration, seed | Not started |
| CP3 | Scan runs clean against fixtures; /sources shows health | Not started |
| CP4 | Signals on fixtures look right (10 shown with rationale) | Not started |
| CP5 | Dashboard, watchlist, stats, outcomes job | Not started |
| CP6 | Public URL verified from a phone, cron running unattended | Not started |

---

## Done

### CP0 — Setup

- Next.js 16 + TypeScript + Tailwind 4 + App Router scaffolded at repo root
  (`--src-dir`, import alias `@/*`).
- Dependencies installed: `drizzle-orm`, `@neondatabase/serverless`, `zod`,
  `@anthropic-ai/sdk`, `rss-parser`, `date-fns`, `date-fns-tz`; dev:
  `drizzle-kit`, `tsx`, `vitest`, `dotenv`.
- `.env.example` with all 10 variables and inline explanation of each.
- `README.md` with exact signup steps per service, the provider decision and
  the Vercel cron finding.
- `src/config/source-seed.ts` — 12 seed sources, each carrying its live
  verification result, poll interval, quality weight and body-storage rule.
- `fixtures/raw/` — four real feed payloads captured live.
- `fixtures/items.json` — 23 normalized items, 11 real and 12 authored, with
  machine-checkable `expected` assertions on 21 of them. Every enabled source
  has at least one fixture.
- Git initialized, branch `main`, remote set to the GitHub repo. **Not pushed
  yet** — push is an ask-first action.
- Cross-model review by a Sonnet reviewer: `docs/reviews/step-0.md`.
  0 blockers, 4 major, 4 minor, 1 nit. All four majors fixed before this
  checkpoint was raised (see below).

### CP1 — Shell and design foundation

- Dark-only theme in `src/app/globals.css`. Tailwind v4 `@theme inline` tokens
  for background/surface/border/text/muted, bullish/bearish/neutral, and a
  separate ok/warn pair for infrastructure status.
- 13px base, 8px rhythm, tight radii, `.num` class for tabular monospace so
  numeric columns align vertically.
- `AppHeader` — sticky slim header, nav with `aria-current`, 1280px container.
- Pages: `/`, `/watchlist`, `/sources`, `/stats`, `/t/[symbol]`.
- States: empty (`StatePanel`), loading (`loading.tsx` + `TableSkeleton`),
  error (`error.tsx` boundary), 404 (`not-found.tsx`).
- `src/lib/types.ts` — the event-type / direction / horizon vocabulary, defined
  once so the Zod schema, Drizzle enums and UI cannot drift.
- `src/lib/format.ts` + 14 unit tests, covering the UTC→PT date boundary.
- `next.config.ts` pins the Turbopack root to the repo, silencing a warning
  where it was inferring a workspace root from an unrelated lockfile in the
  home directory.
- Cross-model review: `docs/reviews/step-1.md`. 0 blockers, 2 major, 2 minor,
  1 nit — all fixed before raising the checkpoint.

### CP1a — Light theme, expanded sources (your change request)

- **Theme switched from dark to light.** Warm white page, near-black text,
  14px base (was 13px), more row padding, zebra striping. Bullish/bearish
  darkened so they still clear contrast requirements against white.
- **Sources: 12 → 40** (29 verified live, 29 enabled). Seven low-signal outlets were added and then deliberately removed again after probing them — see `docs/source-strategy.md`. Composition: 11 EDGAR form types, 5 wires, 6 news outlets, 11 government/regulator, 5 primary databases, 2 Reddit. Newly verified live: SEC 13D, 13G, S-1, SEC press
  releases, FDA, FTC competition, USTR, EIA, BLS, WSJ Markets, Yahoo Finance,
  MarketWatch. Reddit seeded but disabled. See `docs/social-media.md` for why
  X, Instagram and Facebook are not in the list.
- `verified` gained a third state, `unverified`, for sources that are
  plausible but unproven from this machine. Both `blocked` and `unverified`
  ship disabled and get retried from the server in Step 3.

**Two features added to the plan, both landing in CP2 (schema) and CP5 (UI):**

1. **Live price chart on the ticker page.** Clicking a company shows its live
   quote and an interactive chart from the market-data API, alongside its
   signals.
2. **Watchlist entry price tracking.** The watchlist records the price at the
   moment you add a symbol, then shows the return since that moment. This is
   the same question `/stats` answers about signals, asked about your own
   decisions — and it is the most direct measure of whether this tool is worth
   trusting. It changes the `watchlist` table, so it is being designed into
   CP2 rather than bolted on later.

---

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Market data provider | **Finnhub** | 60 req/min free vs Polygon's ~5. The outcomes backfill needs the headroom. |
| Triage model | `claude-haiku-4-5` | Runs on every item; must be cheap. |
| Scoring model | `claude-opus-5` | Runs only on triage survivors. Second-order reasoning is the whole point of the tool, so this is where the budget goes. |
| Project location | Repo root, package name `stockbuddy` | The folder `Stockbuddy` has a capital letter, which npm rejects as a package name; the package is renamed rather than the folder. |
| Poll intervals | 60s for EDGAR + wires, 300–900s for the rest | Catalysts originate in filings and wires. Government feeds move slowly enough that a 60s poll is wasted requests. |
| Theme | **Light**, 14px base | Changed on request. Readability over aesthetics — this is a page you read for a long time. |
| Instagram / Facebook | **Not possible** | Meta killed CrowdTangle in Aug 2024; its replacement is restricted to approved academic and nonprofit researchers. The Graph API only returns data about accounts you own. No legitimate path exists at any price. |
| X (Twitter) | **Deferred, not refused** | Legitimate but metered at ~$0.005/read since Feb 2026. Even a narrow 50-account setup costs ~$150/mo — more than the entire rest of the platform — for a source that mostly echoes news the filings already gave us. Revisit once `/stats` shows whether early chatter is actually the gap. |
| Legacy media outlets | **~10, not hundreds** | Outlets are downstream of the sources we already read: their market-moving facts come from EDGAR, the wires and the regulators, which we ingest directly and minutes earlier. Probing NBC/Fortune/MarketWatch confirmed it — most items were general interest, and the one macro story was BLS data we already pull from BLS. Modelled marginal cost of 100 extra outlets is ~$116/mo for mostly-duplicate content. See `docs/source-strategy.md`. |
| LLM budget | **$2/day → $6/day** | The $2 figure predated any cost arithmetic and was wrong: modelled spend for the current list is $5–10/day. Corrected in `.env.example` with the model shown. |
| Cost control | Rule prefilter + story-level dedupe **before** triage | Dropping routine Form 4 vesting, non-English and non-US items costs nothing and removes ~65% of volume. Clustering the same story across outlets is the difference between ~$285/mo and ~$757/mo. Both move from "nice to have" to required. |
| Reddit | Seeded, disabled, lowest weight | Free and legitimate, so it clears the bar. But retail chatter is mostly reaction to news already in the other feeds; enabling it early would flood the feed and inflate the LLM bill during calibration. |
| Watchlist price tracking | Record `price_at_add`, show return since | Directly answers "is this tool reliable" for the user's own decisions, not just for the model's signals. |
| Seed fields vs DB columns | `store_body` becomes a real column on `sources`; `verified` and `notes` stay seed-only | Raised by review. `store_body` is enforced at ingest time on every scan, so it has to live in the DB. `verified`/`notes` are build-time provenance about how the source list was assembled — they belong in version control, not in a row that a runtime toggle could contradict. |

### Review fixes applied at CP0

| Finding | Fix |
|---|---|
| Second-order fixtures encoded the hard part only as prose | Added structured `secondaryImpacts`, `requiresSplitDirection`, `minSecondaryImpacts`, `secondOrderRequired` so a harness can assert them. |
| Docs claimed 13 `expected` blocks; actual was 18 | Recounted programmatically. Now 21 of 23, stated from a verified count. |
| Three enabled sources had no fixture (10-Q, 10-K, GlobeNewswire earnings) | Added `fx-021`, `fx-022`, `fx-023`. Coverage gap now provably zero. |
| `store_body` / `verified` / `notes` had no schema destination | Decided above, before the CP2 migration makes it expensive. |
| `npm run test` exited 1 with no test files | Added `--passWithNoTests`. |
| Dangling reference to a nonexistent `docs/evals.md` | Removed; the assertion vocabulary is documented in the fixture file itself. |

### Review fixes applied at CP1

| Finding | Fix |
|---|---|
| `formatAge` returned `"0y"` for anything 100–364 days old — it read as "just now" for something months old | Added a months bucket. Three regression tests at the 99d / 150d / 400d boundaries. |
| "Loading, empty and error states" was only one third delivered — no loading skeleton existed, and `StatePanel`'s error tone was never used by any page | Added `loading.tsx` + `TableSkeleton`, `error.tsx` (which deliberately shows only the digest, never `error.message`, since a thrown error will carry the database URL once Step 3 lands) and `not-found.tsx`. |
| `/sources` used bullish green and bearish red for feed health, colliding with the market-direction meaning of those two colors | Added distinct `ok` (cyan) and `warn` (amber) tokens. Green and red now mean market direction and nothing else. |
| Header could overflow at 320px | `shrink-0` on the brand and nav items, `min-w-0` + `overflow-x-auto` on the nav. Verified by measurement at 320/375/390px. |

---

## Verified

| Check | Result |
|---|---|
| SEC EDGAR `getcurrent` Atom (8-K) | Live. Real entries returned 2026-09-04. |
| Federal Register JSON API | Live. No key required. |
| GlobeNewswire public-companies RSS | Live. Real items returned 2026-09-06. |
| Federal Reserve `press_all.xml` | Live. |
| Business Wire RSS | **403 to probe.** Ships disabled. |
| PR Newswire RSS | **403 to probe.** Ships disabled. |
| CNBC RSS | **403 to probe.** Not in the seed list; Finnhub covers aggregated headlines instead. |
| Finnhub free tier | 60 req/min confirmed; includes company news and SEC filings. |
| Vercel cron | Hobby is **once-daily only**; per-minute needs Pro. |
| SEC rate limit | 10 req/s, descriptive User-Agent mandatory. |

---

## Open questions for you

1. **Vercel Pro or external scheduler?** Hobby cannot run a 5-minute cron at
   all — it fails at deploy time, not at runtime. Pro is ~$20/mo and makes
   `vercel.json` work as written; cron-job.org is free but is one more thing
   that can break silently. I'd take Pro for something meant to run unattended,
   but it is your $20.
2. **Business Wire / PR Newswire.** Both refused the probe. I can try a
   server-side fetch with a realistic User-Agent during Step 3 and enable them
   only if they respond. Say if you'd rather I leave them off entirely.
3. **Daily LLM budget.** Defaulted to $2.00/day. The review flagged this as
   likely tight, and I agree: Form 4 is very high volume, and the three
   GlobeNewswire feeds overlap so the same release can arrive up to three
   times. Two mitigations land in Step 3 before any spend happens — dedupe
   runs *before* triage, not after, and the three GlobeNewswire feeds get
   deduped against each other by canonical URL. I'll report measured $/item
   and $/day at CP4 against real volume, and you can set the real number then
   rather than guessing now.

Nothing here blocks CP1–CP2, which need no accounts.

---

## Next

CP1 — dark theme tokens, app shell, dense table styles, shadcn primitives.
