# Social media sources: what is actually possible

You asked for X, Instagram and Facebook, "but all legitimate". That last clause
is the whole answer, so here is the honest state of each, checked 2026-09-06.

## Summary

| Platform | Legitimate access? | Cost | In the seed list? |
|---|---|---|---|
| **Reddit** | Yes — public feeds and a documented API | Free | Yes, disabled by default |
| **X (Twitter)** | Yes, but metered per read | ~$0.005 per post read | No — see below |
| **Instagram** | No | — | No |
| **Facebook** | No | — | No |
| **YouTube** | Yes, Data API free quota | Free tier | Not yet — easy to add later |

---

## Instagram and Facebook: not possible

This is not a budget problem, it is an access problem.

Meta shut down **CrowdTangle** — the tool that let outsiders monitor public
posts — in August 2024. Its replacement, the **Meta Content Library**, is
restricted to people at "qualified academic or nonprofit institutions pursuing
scientific or public-interest research", who apply through a consortium at the
University of Michigan. Most journalists were refused access. A private
investment-research tool does not qualify under any reading of that policy.

The regular Instagram and Facebook Graph APIs only return data about accounts
**you own**. There is no endpoint that returns "recent public posts mentioning
Nvidia". That capability does not exist for us at any price.

The only ways to get Instagram or Facebook data are scraping or buying from a
grey-market reseller. Both violate Meta's terms, both risk account and IP
bans, and the data from resellers is of unknown provenance. You said "alles
legit", so I have not built either, and I would push back if asked to.

## X (Twitter): possible, but the economics are bad for this use case

X changed pricing in February 2026. The old $200/month Basic tier is gone;
new developers are on **pay-per-use at roughly $0.005 per post read**, capped
at 2 million reads a month.

So it is legitimate and technically available. The problem is arithmetic:

| Approach | Reads/day | Cost/day | Cost/month |
|---|---|---|---|
| Follow 50 high-signal accounts, ~20 posts each | 1,000 | $5 | ~$150 |
| Follow 200 accounts | 4,000 | $20 | ~$600 |
| Anything resembling a firehose | 100,000+ | $500+ | $15,000+ |

For comparison, the entire rest of this system — Claude, Neon, Vercel Pro —
runs at roughly $25–70/month. Even the *cheapest* useful X configuration
costs two to six times the whole platform, to add a source whose signal is
mostly reaction to news that EDGAR and the wires already gave us minutes
earlier.

**My recommendation:** leave X out until `/stats` tells us the other 25
sources are working. If, after a month, we can see that the tool's weakness is
missing early chatter rather than missing filings, then a *targeted* X
integration — 30 to 50 specific accounts, not a firehose — becomes a defensible
$150/month. Deciding that with data beats deciding it now on a hunch.

If you want it anyway, say so and I will build it. It is your money and the
integration itself is straightforward.

## Reddit: seeded, but disabled

Reddit has free public feeds and a documented API, so it clears the legitimacy
bar easily. `r/stocks` and `r/wallstreetbets` are in the seed list.

They ship **disabled** and with the lowest quality weights in the system (0.3
and 0.2 against 1.0 for an 8-K), for a reason worth stating plainly: retail
chatter is overwhelmingly *reaction* to news that is already in the other
feeds, not new information. Turning it on early would flood the feed with
low-value items and inflate the LLM bill, which is the opposite of what you
want while we are still calibrating.

Turn them on from `/sources` whenever you like. If they earn their place in the
hit-rate table, raise their weight. That is exactly the question `/stats` is
built to answer.

---

## What replaced the coverage instead

Rather than chase the platforms that are closed, the seed list grew from 12 to
30 sources on the ones that are open — 22 of them verified live and enabled —
including several that produce genuinely market-moving events rather than
commentary about them:

- **FDA press announcements** — approvals and rejections. For biotech this is
  the event itself, and it reliably moves two stocks: the filer's and its
  nearest competitor's.
- **FTC competition releases** — merger challenges. A blocked deal moves both
  parties hard, and it is public before most coverage catches it.
- **SEC 13D filings** — an activist crossing 5% with intent to influence.
  Historically one of the strongest single-filing signals that exists.
- **USTR** — tariffs and trade actions, the classic second-order source.
- **SEC S-1** — IPO registrations, which is how you see a newly public company
  before it has analyst coverage.
- Plus WSJ Markets, Yahoo Finance, SEC press releases, EIA and BLS.
