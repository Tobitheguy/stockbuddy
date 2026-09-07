import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { items, signals, sources } from "../src/db/schema";
import { computeBaseScore, computeScore } from "../src/scoring";
import type { Horizon } from "../src/lib/types";

/**
 * Recompute every stored score with the current formula.
 *
 * Needed whenever computeScore changes, because scores are stored, not derived
 * at read time. Without this the feed shows two scales side by side and the
 * ranking silently means nothing — the worst possible state for a list whose
 * only job is ordering.
 *
 * Costs nothing: no model is called, no source is fetched. Only the arithmetic
 * is redone, from inputs already in the database.
 *
 *   npm run rescore -- --dry-run    show what would change
 *   npm run rescore                 apply
 */
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await db()
    .select({
      id: signals.id,
      magnitude: signals.magnitude,
      confidence: signals.confidence,
      horizon: signals.horizon,
      score: signals.score,
      symbol: signals.symbol,
      sector: signals.sector,
      publishedAt: items.publishedAt,
      qualityWeight: sources.qualityWeight,
    })
    .from(signals)
    .innerJoin(items, eq(items.id, signals.itemId))
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(isNotNull(signals.magnitude), isNotNull(signals.confidence)));

  // A fixed clock for the whole pass. Using Date.now() per row would let the
  // recency decay drift across a long run, so two identical signals could come
  // out differently depending on where they landed in the loop.
  const now = new Date();

  let changed = 0;
  let raised = 0;
  let lowered = 0;
  let sumOld = 0;
  let sumNew = 0;
  let maxOld = 0;
  let maxNew = 0;
  const biggest: Array<{ label: string; from: number; to: number }> = [];

  for (const r of rows) {
    const old = Number(r.score);
    const inputs = {
      magnitude: r.magnitude ?? 1,
      confidence: Number(r.confidence ?? 0),
      sourceWeight: Number(r.qualityWeight),
    };
    const base = computeBaseScore(inputs);
    const next = computeScore({
      ...inputs,
      publishedAt: r.publishedAt,
      now,
      horizon: (r.horizon ?? undefined) as Horizon | undefined,
    });

    sumOld += old;
    sumNew += next;
    maxOld = Math.max(maxOld, old);
    maxNew = Math.max(maxNew, next);

    // base_score is written unconditionally, even when the decayed score is
    // unchanged: a null there makes the feed fall back to the frozen `score`,
    // which is exactly the stale ordering this column exists to remove.
    if (!dryRun) {
      await db()
        .update(signals)
        .set({ baseScore: base.toFixed(2), score: next.toFixed(2) })
        .where(sql`${signals.id} = ${r.id}`);
    }

    if (Math.abs(next - old) < 0.005) continue;
    changed++;
    if (next > old) raised++;
    else lowered++;

    biggest.push({
      label: r.symbol ?? r.sector ?? "—",
      from: old,
      to: next,
    });
  }

  biggest.sort((a, b) => b.to - b.from - (a.to - a.from));

  console.log(
    `\n${dryRun ? "PROBELAUF — nichts geschrieben" : "Angewendet"}\n` +
      `  Signale geprueft : ${rows.length}\n` +
      `  veraendert       : ${changed}  (${raised} hoeher, ${lowered} niedriger)\n` +
      `  Schnitt          : ${(sumOld / (rows.length || 1)).toFixed(1)} -> ${(sumNew / (rows.length || 1)).toFixed(1)}\n` +
      `  Maximum          : ${maxOld.toFixed(1)} -> ${maxNew.toFixed(1)}\n`,
  );

  if (biggest.length > 0) {
    console.log("  Groesste Anhebungen:");
    for (const b of biggest.slice(0, 8)) {
      console.log(
        `    ${b.label.slice(0, 22).padEnd(22)} ${b.from.toFixed(1).padStart(6)} -> ${b.to.toFixed(1)}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("rescore crashed:", e);
  process.exit(1);
});
