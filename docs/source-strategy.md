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

## Recommendation

**Not hundreds. Roughly 30–40 well-chosen sources, which is where we now are.**

The seed list stands at 38 — 26 verified live, 25 enabled. The plan:

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
