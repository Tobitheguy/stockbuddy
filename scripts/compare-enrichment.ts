import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { items, sources } from "../src/db/schema";
import { scoreItem } from "../src/llm/client";
import { fetchFilingText } from "../src/sources/edgar-document";
import { computeScore } from "../src/scoring";

/**
 * One-off comparison: score a handful of EDGAR filings twice — once on the
 * feed metadata alone, once on the filing text — and print both.
 *
 * This exists to answer "why are the scores so low" with a measurement rather
 * than an argument. It writes no signals.
 */

const N = Number(process.argv[2] ?? 4);

async function main() {
  const rows = await db()
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      url: items.canonicalUrl,
      publishedAt: items.publishedAt,
      sourceName: sources.name,
      qualityWeight: sources.qualityWeight,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(sources.kind, "edgar"),
        isNotNull(items.processedAt),
        // The filing types where the feed title hides the most.
        sql`${items.title} ~ '^(8-K|425|SC 13D|SC TO-T)'`,
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(N);

  console.log(`${rows.length} Einreichungen, je zwei Bewertungen.\n`);
  let cost = 0;

  for (const item of rows) {
    console.log("=".repeat(72));
    console.log(item.title);

    const before = await scoreItem({ ...item, body: null }, null);
    cost += before.cost;

    const text = await fetchFilingText(item.url);
    const after = text
      ? await scoreItem({ ...item, body: text }, null)
      : { signals: [], cost: 0 };
    cost += after.cost;

    const show = (label: string, s: typeof before.signals) => {
      if (s.length === 0) {
        console.log(`  ${label.padEnd(12)} keine Signale`);
        return;
      }
      for (const x of s) {
        const score = computeScore({
          magnitude: x.magnitude,
          confidence: x.confidence,
          sourceWeight: Number(item.qualityWeight),
          publishedAt: item.publishedAt,
          now: new Date(),
          horizon: x.horizon,
        });
        console.log(
          `  ${label.padEnd(12)} ${String(score.toFixed(0)).padStart(3)}  ` +
            `${(x.symbol || x.sector).padEnd(10)} ${x.direction.padEnd(8)} ` +
            `mag ${x.magnitude} conf ${x.confidence.toFixed(2)}  ${x.eventType}`,
        );
        console.log(`  ${" ".repeat(12)}      ${x.rationale.slice(0, 150)}`);
        label = "";
      }
    };

    console.log(`  Dokument: ${text ? `${text.length} Zeichen geladen` : "NICHT geladen"}`);
    show("OHNE Text", before.signals);
    show("MIT Text", after.signals);
  }

  console.log("=".repeat(72));
  console.log(`Kosten dieses Vergleichs: $${cost.toFixed(4)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
