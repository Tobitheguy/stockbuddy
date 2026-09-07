# Progress

Living status doc. Updated at every checkpoint.

**Repo:** https://github.com/Tobitheguy/stockbuddy
**Current checkpoint:** CP0 — awaiting review

---

## Checkpoints

| | Checkpoint | Status |
|---|---|---|
| CP0 | Repo, env example, README setup, fixtures | **Awaiting approval** |
| CP1 | Shell + design tokens rendering | Not started |
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

---

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Market data provider | **Finnhub** | 60 req/min free vs Polygon's ~5. The outcomes backfill needs the headroom. |
| Triage model | `claude-haiku-4-5` | Runs on every item; must be cheap. |
| Scoring model | `claude-opus-5` | Runs only on triage survivors. Second-order reasoning is the whole point of the tool, so this is where the budget goes. |
| Project location | Repo root, package name `stockbuddy` | The folder `Stockbuddy` has a capital letter, which npm rejects as a package name; the package is renamed rather than the folder. |
| Poll intervals | 60s for EDGAR + wires, 300–900s for the rest | Catalysts originate in filings and wires. Government feeds move slowly enough that a 60s poll is wasted requests. |
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
