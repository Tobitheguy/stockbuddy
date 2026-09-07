# CP1 Review — Signal Desk (independent cross-model review)

Reviewer model: Claude Sonnet 5 (independent of the model that authored CP1).
Scope reviewed: uncommitted working-tree changes on `main` (base `3e5b9a0`) covering dark theme tokens, app shell, nav, dense table styles, page states, and `src/lib/format.ts`/`format.test.ts`. Ran `git log --oneline -5` and `git diff HEAD~1 --stat` to orient; CP1 is not yet committed, so it was reviewed as working-tree diff against `3e5b9a0`.

## Verdict

CP1 delivers a clean, honest, well-built foundation with no scope drift: `npm run build`, `typecheck`, `lint`, and `test` all pass with zero warnings, no database/API/LLM code exists anywhere in `src` (grep-confirmed), and the two "preview" pages (`/` and `/sources`) both carry prominent, honestly-worded banners that a user cannot plausibly miss or mistake for live data. The Tailwind v4 token pipeline was verified end-to-end against the actual built CSS (not just read) — every custom utility (`bg-bullish-dim`, `text-bearish`, `bg-surface-raised`, the `outline-ring/50` opacity modifier, and the `--font-sans → --font-geist-sans` chain the CP0 comment says was broken) resolves correctly and the claimed font-mapping fix genuinely works. Real-browser contrast measurements (via canvas pixel-sampling of actual computed/composited colors, not manual oklch math) show every text pair comfortably clears WCAG AA, direction is consistently double-coded with glyph+label+color, and the nav correctly uses `aria-current`. Two real problems surfaced under verification rather than inspection: `formatAge` renders a nonsensical `"0y"` for anything 100–364 days old (proven with a failing test against the actual function, then reverted), and CP1's required scope explicitly promised "loading, empty and error states" but only the empty state is actually built and exercised on any page — there is no `loading.tsx`/skeleton anywhere and `StatePanel`'s `tone="error"` branch is never invoked from any page, making it untested dead code. A responsive edge case was also found by measurement: the header nav overflows and would cause page-level horizontal scroll at 320px viewport width (iPhone SE), though it fits cleanly at the 375px width the task asked me to check. Nothing here blocks CP2, but the two MAJOR items are real, verified gaps against CP1's own stated deliverables.

## Findings

| Severity | File | Finding | Recommendation |
|---|---|---|---|
| MAJOR | `src/lib/format.ts:47` | `formatAge` returns `"0y"` for any item 100–364 days old. The branch structure is `days < 100 → "Nd"`, else `` `${Math.floor(days/365)}y` ``; for `days` in `[100,364]`, `Math.floor(days/365)` is `0`, so a 5-month-old item renders as "0y" — a string that reads as "essentially just happened" for something that is, in fact, months old. Proved with a real (then-reverted) test: `formatAge(now - 150d, now)` returns `"0y"`, confirmed failing against the actual implementation via `npm run test`. No existing test exercises anything past 5 days old. | Add a months bucket, e.g. `days < 100 → Nd`, `days < 365 → ${Math.floor(days/30)}mo`, else `${Math.floor(days/365)}y`, and add a regression test at the 100–364 day boundary. |
| MAJOR | `src/app/*/page.tsx`, `src/components/page-shell.tsx:27-61` | CP1's required scope explicitly lists "Loading, empty and error states for pages," but only the empty state is actually built and demonstrated. There is no `loading.tsx` file, no `<Suspense>` boundary, and no skeleton/loading component anywhere in `src/app` (confirmed via `Glob` — the app tree contains only `layout.tsx` and five `page.tsx` files). `StatePanel`'s `tone="error"` prop exists and is styled correctly (`border-bearish/40`, `text-bearish` title, confirmed by reading the code), but grepping the whole `src` tree for `tone=` returns zero matches — no page ever passes `tone="error"`, so this code path has never actually been rendered or visually checked. | Before calling this checkpoint's UI-states requirement done: add at least one `loading.tsx` (even a simple skeleton reusing `table-dense` row shapes) and wire `StatePanel tone="error"` into at least one page (e.g., a placeholder "source list failed to load" render path) so both states are demonstrated and visually verified, not just implemented as unused API surface. |
| MINOR | `src/components/app-header.tsx:38-64` | The header nav (logo + 4 nav links + `gap-6`) overflows its row by 28px at a 320px viewport (iPhone SE and similar), causing page-level horizontal scroll — there is no `overflow-x-auto` wrapper on the header the way `TableScroller` protects the table. Verified by constraining the header's own flex row (not `html`/`body`, whose `clientWidth` doesn't respond to CSS `width` on the root — a measurement pitfall worth noting) to 320px/360px/375px and reading `scrollWidth` vs `clientWidth`: 375px and 360px both fit with 0px overflow (with the `hidden sm:inline` "Research only" text correctly excluded, since that's a real Tailwind `sm:` breakpoint at 640px), 320px overflows by 28px. The 375px width the task named specifically is clean. | Low priority given this is a private desktop-first tool, but if phone use is a real scenario, either let the nav wrap/scroll on very narrow widths or drop `gap-6` to `gap-3`/`gap-4` to buy back the margin. |
| MINOR | `src/app/sources/page.tsx:69-78` | The Verified column reuses `text-bullish`/`text-bearish` to color "live" vs "403" source-health status. `globals.css:37` explicitly documents bullish/bearish/neutral as "the only saturated colors in the product" reserved for "Signal semantics," but this page overloads the same green/red vocabulary for an unrelated axis (infra verification status, not market direction). Functionally harmless (the cell text itself disambiguates), but it contradicts the design system's own stated rule and risks a viewer pattern-matching "green in this app = bullish." | Use `text-foreground`/`text-muted-foreground` (or a distinct neutral pill) for infra status, keeping bullish/bearish exclusively for market direction as documented. |
| NIT | `components.json`, `src/components/ui/{table,badge,dialog,sheet,toggle}.tsx` | Per CP1 scope these only need to be "available," which they are (present, compile, build succeeds) — but none is actually imported anywhere in `src/app` or `src/components/*.tsx` (grep-confirmed: zero non-generated imports of any `@/components/ui/*`). `DirectionBadge` reimplements what `ui/badge.tsx` already provides, and both table pages hand-roll `<table>` rather than using `ui/table.tsx`. Not a defect against the stated scope, just a maintenance note. | Worth deciding in Step 2/3 whether `DirectionBadge`/raw tables should be reconciled with the generated `ui/badge.tsx`/`ui/table.tsx`, or whether the generated files should be dropped until actually needed. |

No BLOCKER-severity findings.

---

## 1. Scope drift

Clean. Grepped `src` for `fetch(`, `process.env`, `drizzle`, `neon`, `anthropic`, `@/lib/db`, `ANTHROPIC_API_KEY`, `DATABASE_URL` (case-insensitive) — the only hit is a comment in `src/lib/types.ts:5` referencing "the Drizzle enums (Step 2)" as a future plan, not code. No API routes exist. No LLM calls exist. No database access exists.

The two intentional previews are both honestly and prominently labelled:
- `src/app/page.tsx:106-116` renders a `StatePanel` titled **"Layout preview — not live data"** in bold `text-foreground`, directly under the page title and directly above the table, unconditionally visible on load (not a dismissible/collapsible banner, not below the fold given only 6 preview rows). The body text explicitly says "nothing on this page is real." A user cannot scroll past or miss this before reaching the table.
- `src/app/sources/page.tsx:22-33` renders a `StatePanel` titled **"Seed configuration — no scan has run"**, explaining that health columns are blank because the scanner doesn't exist, and explains *why* two sources ship disabled (403 on probe) rather than fabricating numbers.

Both banners are code-adjacent comments (`page.tsx:8-14`, `sources/page.tsx:4-11`) as well as UI copy, so the "preview" framing is documented for the next engineer too. This fully satisfies the honesty bar the task asked me to judge.

## 2. Accessibility

**Color is never the sole carrier of direction.** `src/components/direction-badge.tsx:13-23` pairs every badge with a glyph (▲/▼/■) and a text label ("Bullish"/"Bearish"/"Neutral") in addition to color, with an explicit comment citing the ~1-in-12 red/green colorblindness rate as the reason. `SignalScore` (`src/components/signal-score.tsx:32-41`) gives its color bar `role="img" aria-label="Score N of 100"`, so the numeric value is available to assistive tech independent of the bar's color/width.

**Focus-visible states.** `src/app/globals.css:118-121` sets `* { @apply border-border outline-ring/50; }` and `app-header.tsx:48` adds `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` to nav links. Verified in the actual built CSS (`.next/static/chunks/2-2ou9jgfoflc.css`) that `--tw-outline-style` has an initial value of `solid` (via `@property`), and `.focus-visible\:outline-2:focus-visible{outline-style:var(--tw-outline-style);outline-width:2px}` — so focused nav links get a real 2px solid cyan (`--ring`) outline with 2px offset, not `outline: none`. The ring color is deliberately distinct from bullish/bearish (comment at `globals.css:102-104`), which is a good call — an accessibility signal should never share a hue with a market signal.

**`aria-current` on nav.** `app-header.tsx:45` sets `aria-current={active ? "page" : undefined}` correctly, only on the exact matching route (`isActive` at line 14-18 correctly special-cases `/` so it doesn't match every route).

**Computed contrast ratios** — measured from the live, rendered page via a canvas pixel-sample of `getComputedStyle(...).color`/`backgroundColor` (so the browser's own oklch→sRGB conversion and any real alpha-compositing is captured exactly, not approximated), then WCAG relative luminance / contrast ratio computed from those sampled sRGB bytes:

| Pair | Ratio | WCAG AA requirement | Result |
|---|---|---|---|
| `foreground` on `background` (body text) | **15.60:1** | 4.5:1 | Pass (AAA too) |
| `muted-foreground` on `background` | **6.01:1** | 4.5:1 | Pass |
| `muted-foreground` on table header (`.table-dense th`, same color token) | **6.01:1** | 4.5:1 | Pass |
| Nav inactive link (`muted-foreground`) on composited header bg (`background/85` over page bg) | **6.02:1** | 4.5:1 | Pass |
| Nav active link (`foreground`) on `surface-raised` chip | **13.37:1** | 4.5:1 | Pass |
| `bullish` text directly on `background` | **8.82:1** | 4.5:1 | Pass |
| `bearish` text directly on `background` | **5.93:1** | 4.5:1 | Pass |
| `bullish` text on its own `bullish-dim` chip background (composited) | **7.08:1** | 4.5:1 | Pass |
| `bearish` text on its own `bearish-dim` chip background (composited) | **5.11:1** | 4.5:1 | Pass |

All nine pairs clear AA for normal-size text with real margin; several clear AAA (7:1). Note: my first pass at this used manual oklch→linear-RGB math and predicted the bearish badge chip would fail (~3.5:1); that was wrong because CSS alpha-compositing happens in gamma-encoded sRGB space, not linear light, and the ground-truth browser measurement (5.11:1) is what's reported above — flagging this because it's a real methodological trap for anyone re-checking this later with a quick oklch calculator instead of measuring the composited pixel.

One non-text pair worth a mention, not a finding: `border` on `background` is only **1.42:1** — well under the 3:1 WCAG 1.4.11 non-text threshold for meaningful UI-component boundaries. Today this is only used for decorative row dividers and card outlines (exempt from 1.4.11), and no form input is actually rendered anywhere in CP1, so it's dormant risk rather than an active failure. Worth re-checking once `ui/input.tsx` is actually used in Step 2+, since an input whose only boundary cue is a 1.42:1 border would be hard to see.

## 3. Correctness (`src/lib/format.ts` / `format.test.ts`)

The DST/timezone handling is solid and the tests genuinely exercise the load-bearing case rather than restating the implementation:
- `format.test.ts:5-8` and `:10-15` test the exact 23:30 UTC → same-PT-day and 02:30 UTC → previous-PT-day cases the build plan calls out, with comments explaining *why* each is the interesting case (not just asserting a value).
- `format.test.ts:17-20` separately tests PST (January) vs. the other tests' PDT (September), so the DST offset itself is exercised, not just one fixed offset baked into every test.
- These are real assertions against `date-fns-tz`'s `formatInTimeZone`, which correctly derives wall time from an IANA zone for a given instant — I did not find a DST bug here. Spring-forward/fall-back ambiguity only matters when parsing a local wall-clock string into an instant, which this code never does (it only formats already-known UTC instants), so that entire bug class doesn't apply.

Bug found and proven (see MAJOR finding above): `formatAge` (`format.ts:31-48`) renders `"0y"` for any age in `[100, 364]` days, because the two branches jump straight from a day-counter to a year-counter with nothing covering the "several months" range. I added a test (`formatAge(now - 150 days, now)` expecting not `"0y"`), ran `npm run test`, watched it fail with `AssertionError: expected '0y' not to be '0y'`, then reverted the test since I'm reviewing, not fixing. This is a real, currently-unexercised bug: CP1's shipped preview data never uses an item older than a day, so it doesn't manifest in today's UI, but the ticker page's "90-day sparkline" and "next earnings date" features planned for Step 5 will hit this range constantly.

Other things I tried to break and could not: `formatAge`'s future-clamp (`seconds < 0 → "0s"`) is deliberate per the comment and correctly tested; `formatReturn`'s null/undefined/NaN → em-dash handling is correct and distinctly tested from the `0` → `"+0.00%"` case (an easy off-by-none bug this suite correctly guards against, since `pct === 0` must not be confused with "unknown").

## 4. Tailwind v4 correctness

Verified against the actual `npm run build` output (`.next/static/chunks/2-2ou9jgfoflc.css`), not just by reading `globals.css`:

- `bg-bullish-dim`, `text-bearish`, `bg-surface-raised`, `bg-bullish`, `text-bullish`, `bg-neutral-dim`, `text-neutral` all compile to real declarations referencing the underlying custom property (e.g. `.text-bearish{color:var(--bearish)}`) — none of them silently produced empty rules, which is the classic Tailwind v4 `@theme` failure mode this review was asked to rule out.
- Opacity-modifier utilities correctly generate the progressive-enhancement pattern Tailwind v4 uses: `.border-bearish\/40{border-color:var(--bearish)}` (fallback) followed by `.border-bearish\/40{border-color:color-mix(in oklab, var(--bearish) 40%, transparent)}` (real value), and the same pattern for the base `* { outline-ring/50 }` rule, confirmed nested inside `@supports (color: color-mix(in lab, red, red))`.
- **`--font-sans` → Geist fix, verified working**: the built CSS shows `html{font-family:var(--font-geist-sans);...}` — the `@apply font-sans` on `html` (`globals.css:123-124`) got inlined directly to `var(--font-geist-sans)`, and `--default-font-family:var(--font-geist-sans)` is set in the theme block that Tailwind's Preflight consumes. This is a genuine, verified fix of the self-referential default the CP1 comment (`globals.css:26-28`) says shadcn generated; I confirmed it by inspecting the compiled CSS rather than trusting the comment.

## 5. Responsive / overflow

`TableScroller` (`page-shell.tsx:64-66`, `<div className="w-full overflow-x-auto">`) works exactly as intended: constraining `main` (the page's content wrapper) to 375px and measuring `scrollWidth` vs `clientWidth` gives **0px overflow** — the wide table scrolls inside its own container and never forces the page body to scroll. This was verified by direct measurement, not by reading the CSS and assuming (`window`/`resize_window` did not reliably change `window.innerWidth` in this sandboxed browser, so I constrained the actual layout boxes — `main` and `header > div` — directly and read their native `scrollWidth`/`clientWidth`, which is not sensitive to that limitation the way `document.documentElement.clientWidth` is, since the latter doesn't respond to an author-set `width` on the root element and gave a misleading `1690` on my first attempt).

The one real gap (MINOR finding above): the header nav overflows at 320px, not at 375px. The task's named width (375px) is clean.

## 6. Correctness bugs and dead code

`npm run typecheck`, `npm run lint`, and `npm run build` all pass with zero errors/warnings, and `eslint-config-next/typescript` is wired into `eslint.config.mjs`, which covers unused-import/unused-var detection within files. I did not find any unused import, any TypeScript that type-checks but is logically wrong (beyond the `formatAge` bug above), or any client/server boundary mistake: `app-header.tsx` correctly has `"use client"` (it's the only component using a hook, `usePathname`); every `page.tsx` is a plain server component; `t/[symbol]/page.tsx:3-7` correctly `await`s the Next.js 16 async `params` (`PageProps<"/t/[symbol]">`), which typechecks and builds successfully.

The dead-code items are the shadcn-generated `ui/*` components (NIT above, not a defect against CP1's stated scope) and `StatePanel`'s `tone="error"` branch (rolled into the MAJOR loading/error-states finding, since it's dead specifically because no page ever exercises it).

---

## What I verified by running it

- `npm run typecheck` — passes, zero errors.
- `npm run lint` — passes, zero warnings.
- `npm run test` — 11/11 passing; additionally added and ran a 12th probe test for the `formatAge` "0y" bug, watched it fail (`AssertionError: expected '0y' not to be '0y'`), then reverted it (repo is back to the original 11 tests).
- `npm run build` — succeeds; inspected the actual generated CSS in `.next/static/chunks/2-2ou9jgfoflc.css` to confirm custom Tailwind v4 tokens resolve to real declarations (not silently empty), confirm the opacity-modifier `color-mix` progressive-enhancement pattern is present, and confirm the `--font-sans → --font-geist-sans → Geist` chain actually reaches `html`'s `font-family`.
- Loaded the running dev server (`http://localhost:3000`, already up) in a real Chrome tab and used canvas pixel-sampling of `getComputedStyle` output to get ground-truth composited sRGB colors for: body text, muted text, table headers, nav (active/inactive), and all three direction badges (chip background composited with page background) — then computed WCAG contrast ratios from those sampled bytes. All 9 measured text pairs pass AA; results table in section 2.
- Measured real layout boxes (`header > div`, `main`) at forced 320px/360px/375px widths and read `scrollWidth`/`clientWidth` to test overflow behavior, since the browser's viewport (`window.innerWidth`) did not respond to the `resize_window` tool in this environment — confirmed the table/page-body never scrolls horizontally at 375px (0px overflow) and found the header nav does overflow at 320px (28px).
- Grepped the full `src` tree for `fetch(`, `process.env`, `drizzle`, `neon`, `anthropic`, `@/lib/db`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, and `tone=` to independently confirm scope-drift and dead-code claims rather than relying on a read-through.
