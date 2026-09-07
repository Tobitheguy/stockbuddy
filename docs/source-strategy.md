# Do we need hundreds of news outlets?

You asked: *are the sources we already have the sources where CNBC, Business
Insider, CNN and NBC get their material from?*

**Mostly yes.** That is the single most useful thing to understand about this
system, so this document sets out the evidence and the arithmetic rather than
just asserting it.

---

## Where a market-moving story actually comes from

Take any catalyst that moves a US-listed stock and trace it backwards. It
almost always starts in one of four places:

| Origin | Do we already have it? |
|---|---|
| An SEC filing (8-K, 10-Q, 13D, Form 4, S-1) | **Yes** — direct from EDGAR, minutes after filing |
| A company press release | **Yes** — direct from the wires (GlobeNewswire; Business Wire and PR Newswire pending) |
| A government or regulator action (FDA, FTC, Fed, USTR, SEC) | **Yes** — direct from the agency |
| A journalist's own scoop from unnamed sources | **No** — this is the real gap |

When CNBC publishes "Company X wins $2.6bn Navy contract", a reporter read the
same wire release we already ingested, and published a few minutes later. The
outlet is **downstream** of our source, not a parallel one. Adding CNBC does
not add the signal; it adds a slower, second copy of a signal we already have.

### The evidence from actually fetching them

Not theory — this is what the outlet feeds returned when probed on 2026-09-06:

- **NBC News Business**, top 3 items: a gas-price tracker; a story about a Fox
  News anchor's employment status; *"U.S. added 162,000 jobs in August"* — which
  is BLS data we already pull from BLS directly.
- **Fortune**, top 3: a Treasury-yields piece; a volcano in Indonesia
  cancelling flights; a story about a golf course. One of three is financial.
- **MarketWatch Top Stories**, top 3: three personal-finance advice columns
  about inheritance and mortgages. Zero market news.
- **Benzinga**: the feed responds, but returned SEO crypto price-prediction
  pages rather than news.
- **MarketWatch MarketPulse** was the exception — *"Jobless claims fall to
  lowest level since mid-May"*, tight and factual. It is now enabled at a
  relatively high weight.

That is the pattern. Most outlet feeds are majority non-signal, and the
signal they do carry, we already had.

---

## What outlets genuinely add

Three things, and they are worth something:

1. **Exclusive scoops.** "X is exploring a sale, according to people familiar."
   There is no filing for this. Reuters, Bloomberg, WSJ and The Information
   originate these. This is the only category we cannot reach another way.
2. **Synthesis.** Connecting two facts a filing states separately.
3. **Private-company news** that later affects a listed competitor.

Reuters and AP are therefore in the seed list as high-weight entries — both
were unreachable from this machine and ship disabled, and Step 3 retries them
from the server. They are worth more than a dozen aggregators.

---

## What hundreds of outlets would cost

This is where "hundreds" stops being free. Every ingested item gets read by
Claude in Stage A triage, so item count is the cost driver.

Assumptions: Haiku 4.5 triage at $1/$5 per MTok, Opus 5 scoring at $5/$25,
system prompts cached, ~250 tokens per item at triage and ~1,200 at scoring.
That works out to **$0.00049 per triaged item** and **$0.0187 per scored item**.

| Scenario | Raw items/day | Sent to Claude | Cost/day | Cost/month |
|---|---|---|---|---|
| Current 22 sources, no prefilter | 10,000 | 10,000 | $10.51 | **$315** |
| Current + rule-based prefilter | 10,000 | 3,500 | $5.64 | **$169** |
| +100 outlets, prefilter + story dedupe | 24,000 | 5,280 | $9.50 | **$285** |
| +100 outlets, **no** dedupe | 24,000 | 24,000 | $25.22 | **$757** |

Two conclusions fall out of that table.

**First: the $2/day budget in `.env.example` was fantasy, and I should have
run this arithmetic before writing it.** Even the current source list is
roughly $170–315/month depending on filtering. That number needs to be your
decision, not my guess, and it is why the budget cap exists as a hard stop.

**Second: the marginal cost of 100 extra outlets is about $116/month** — and
what it buys is mostly the same stories we already have, arriving later.

---

## What actually makes this cheaper *and* better

Not fewer sources. Better filtering before the expensive part.

1. **Rule-based prefilter, costs nothing.** Roughly 65% of raw items can be
   dropped before any model call: Form 4 rows whose transaction code marks
   routine 10b5-1 vesting (the single largest volume source in EDGAR, and
   almost pure noise), non-English releases, and issuers not on a US exchange.
2. **Story-level dedupe, not just URL dedupe.** When 40 outlets carry the same
   contract award, cluster them and triage *once*, keeping the earliest and
   highest-quality source as canonical. This is the difference between $285 and
   $757 a month.
3. **Weight by distance from the primary document.** An 8-K is 1.0. A wire
   release is 0.9. An outlet relaying that wire is 0.4. Already implemented in
   the seed config.

With those in place, adding outlets becomes cheap enough to be worth doing for
the scoop coverage alone.

---

## "How many would you run if it were your money?"

About **50**, which is where the list now sits (47). But the composition
matters far more than the number, and my answer to "I don't want to miss
news" is not *more outlets* — it is *more primary databases*.

Here is the thing worth internalising: **you are far more likely to miss a
signal because it was never in a news article at all than because you were
missing the outlet that carried it.** The stories every outlet runs are the
ones we already get from EDGAR and the wires. The genuinely missable events
sit in government databases that nobody reads.

Four of those are now wired in, all free, all no-key, all verified live:

| Source | What it catches that news does not |
|---|---|
| **USASpending** | A federal contract award is recorded when the agency obligates the money — which can precede the company's own press release. A defence or infrastructure win shows up here first. |
| **ClinicalTrials.gov** | A phase-3 trial flipping to `TERMINATED` or `SUSPENDED`, plus the `WhyStopped` field. Sponsors do not put out a release the moment they stop a trial. |
| **openFDA** | Structured approval records for every sponsor, not only the ones FDA chose to write a press release about. |
| **SEC NT 10-K / NT 10-Q** | A company formally telling the SEC it cannot file on time. Low volume, very high signal — it frequently precedes a restatement, an auditor dispute or a going-concern warning. Practically nobody watches this feed. |

Plus three SEC form types that the 8-K feed does not cover: **SC TO-T**
(tender offers — a takeover bid), **425** (merger communications), and **6-K**
(how a US-listed foreign issuer discloses material news at all).

That is the difference between breadth and depth. Adding NBC News gets you a
slower copy of a jobs report. Adding NT 10-K gets you a company quietly
admitting it cannot close its books.

### The failure mode that actually matters

There are two ways to miss a signal, and they pull in opposite directions:

1. **It was never ingested.** Fixed by coverage. Largely solved — company
   catalysts are legally required to be filed or are press-released, and we
   read both at source.
2. **It was ingested, ranked 340th, and you never scrolled that far.**
   Fixed by *ranking and filtering*, and it gets strictly worse with every
   source added.

Failure mode 2 is the one that will actually bite. Doubling the sources
doubles the volume; it does not double your attention. At some point another
source makes you *more* likely to miss the important thing, not less. That
point is well before "hundreds".

This is why the score, the quality weights and `/stats` matter more than the
source count — and why the watchlist and a score threshold are the real
safety net. A high-scoring signal on a symbol you follow surfaces regardless
of how much noise is behind it.

---

## Recommendation

**Not hundreds. Roughly 50 well-chosen sources, which is where we now are.**

The seed list stands at 47 — 33 verified live, 33 enabled. The plan:

- **Keep the primary sources at full weight.** EDGAR, the wires, the
  regulators. This is where catalysts originate and where we beat the outlets
  on time.
- **Add a handful of high-value outlets for scoops** — Reuters, AP, WSJ,
  MarketPulse. Enabled once Step 3 proves reachability.
- **Do not add the long tail.** Each additional aggregator adds cost and
  latency for a duplicate.
- **Let `/stats` decide the rest.** Once outcomes are tracked, hit rate *by
  source* is measurable. If NBC News never produces a signal that beats its
  cost, its weight goes to zero — and that will be a fact, not an opinion.

If after a month `/stats` shows we are missing stories that outlets had first,
adding more is a twenty-line config change. The infrastructure supports
hundreds. The argument is that hundreds is the wrong number, not that it is
hard.
