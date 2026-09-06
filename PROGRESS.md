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
- `fixtures/items.json` — 20 normalized items, 11 real and 9 authored, with
  `expected` assertions on 13 of them.
- Git initialized, branch `main`, remote set to the GitHub repo. **Not pushed
  yet** — push is an ask-first action.

---

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Market data provider | **Finnhub** | 60 req/min free vs Polygon's ~5. The outcomes backfill needs the headroom. |
| Triage model | `claude-haiku-4-5` | Runs on every item; must be cheap. |
| Scoring model | `claude-opus-5` | Runs only on triage survivors. Second-order reasoning is the whole point of the tool, so this is where the budget goes. |
| Project location | Repo root, package name `stockbuddy` | The folder `Stockbuddy` has a capital letter, which npm rejects as a package name; the package is renamed rather than the folder. |
| Poll intervals | 60s for EDGAR + wires, 300–900s for the rest | Catalysts originate in filings and wires. Government feeds move slowly enough that a 60s poll is wasted requests. |

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
3. **Daily LLM budget.** Defaulted to $2.00/day. I'll report actual measured
   spend at CP4 once real volume is scored, and you can move it then.

Nothing here blocks CP1–CP2, which need no accounts.

---

## Next

CP1 — dark theme tokens, app shell, dense table styles, shadcn primitives.
