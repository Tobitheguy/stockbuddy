import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { items, signals, sources } from "../src/db/schema";
import { runProcess } from "../src/ingest/process";

/**
 * Re-run scoring on SEC filings that were scored before the filing text was
 * being fetched.
 *
 * Those runs saw only a form type and a byte count — "425 - SYSCO CORP … Size:
 * 974 KB" — so the model was reasoning from a filename and correctly returned
 * low confidence. The signals it produced are not wrong so much as uninformed,
 * and they sit permanently at the bottom of the feed where they cannot be
 * distinguished from genuinely dull filings.
 *
 * This clears those signals and un-marks the items, so the normal pipeline
 * picks them up and reads them properly. It is deliberately restricted by form
 * type: re-reading 86 routine Form 4s costs the same per item as re-reading an
 * 8-K and returns far less.
 *
 *   npm run reprocess-filings -- --dry-run     show what would be re-read
 *   npm run reprocess-filings                  8-K and 425 (the default set)
 *   npm run reprocess-filings -- --forms 6-K   a different set
 */

const DEFAULT_FORMS = ["8-K", "8-K/A", "425"];

const dryRun = process.argv.includes("--dry-run");
const formsIndex = process.argv.indexOf("--forms");
const forms =
  formsIndex > -1
    ? process.argv[formsIndex + 1].split(",").map((f) => f.trim())
    : DEFAULT_FORMS;

/** Measured on the last full run: $1.40 for 110 items. */
const COST_PER_ITEM_USD = 0.0128;

async function main() {
  // Titles look like "8-K - COMPANY NAME (0001234567) (Filer)".
  const pattern = `^(${forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}) `;

  const targets = await db()
    .select({ id: items.id, title: items.title })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(sources.kind, "edgar"),
        isNotNull(items.processedAt),
        // Only items that were never enriched. One that already has text was
        // read properly and re-reading it would buy nothing.
        isNull(items.bodyText),
        sql`${items.title} ~ ${pattern}`,
      ),
    );

  const ids = targets.map((t) => t.id);

  console.log(`Formulare : ${forms.join(", ")}`);
  console.log(`Betroffen : ${ids.length} Meldungen ohne Dokumenttext`);
  console.log(
    `Kosten    : geschaetzt $${(ids.length * COST_PER_ITEM_USD).toFixed(2)} ` +
      `(gemessen $${COST_PER_ITEM_USD.toFixed(4)}/Meldung)`,
  );

  if (ids.length === 0 || dryRun) {
    if (dryRun) {
      console.log("\nPROBELAUF — nichts geaendert. Beispiele:");
      for (const t of targets.slice(0, 8)) console.log(`  ${t.title}`);
    }
    process.exit(0);
  }

  // Delete first, then un-mark. The unique key is (item, symbol, sector), so
  // leaving the old rows in place would make the good new signal collide with
  // the uninformed old one and be silently dropped by onConflictDoNothing —
  // the run would report success and change nothing.
  const removed = await db()
    .delete(signals)
    .where(sql`${signals.itemId} in ${ids}`)
    .returning({ id: signals.id });

  await db()
    .update(items)
    .set({ processedAt: null })
    .where(sql`${items.id} in ${ids}`);

  console.log(`\n${removed.length} alte Signale entfernt, ${ids.length} Meldungen freigegeben.`);
  console.log("Starte Neubewertung — das Budget-Limit greift wie sonst auch.\n");

  const summary = await runProcess({ limit: ids.length });

  console.log(
    `Lauf #${summary.runId}  ${(summary.durationMs / 1000).toFixed(0)}s\n` +
      `  gelesen        : ${summary.itemsConsidered}\n` +
      `  ans Modell     : ${summary.itemsSentToModel}\n` +
      `  aussortiert    : ${summary.itemsTriagedOut}\n` +
      `  neue Signale   : ${summary.signalsCreated}\n` +
      `  davon 2. Ordng : ${summary.secondOrderSignals}\n` +
      `  Kosten         : $${summary.llmCostUsd.toFixed(4)}\n` +
      (summary.haltedOnBudget ? "  ABGEBROCHEN: Tagesbudget erreicht\n" : ""),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("reprocess-filings crashed:", e);
  process.exit(1);
});
