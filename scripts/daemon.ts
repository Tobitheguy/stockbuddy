import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runScan } from "../src/ingest/scan";
import { runProcess } from "../src/ingest/process";

/**
 * Local stand-in for the Vercel crons: scan + score in a loop.
 *
 *   npm run daemon
 *
 * Leave it running (and the machine on) and the feed keeps itself current —
 * wake up to whatever the night produced. This exists because the deployed
 * cron only runs once the Vercel environment variables are set; until then,
 * this is the "new signals in the morning" mechanism, honestly limited by the
 * laptop lid.
 *
 * The same guards apply as in production: per-source poll intervals inside
 * the scan, items scored at most once, and the daily LLM budget hard-stops
 * spending. Ctrl+C to stop.
 */

const INTERVAL_MS = 10 * 60 * 1000;

let stopping = false;
process.on("SIGINT", () => {
  console.log("\nStoppe nach dem aktuellen Durchlauf …");
  stopping = true;
});

function stamp(): string {
  return new Date().toLocaleTimeString("de-DE");
}

async function cycle(n: number): Promise<void> {
  try {
    const scan = await runScan({});
    console.log(
      `[${stamp()}] #${n} Scan: ${scan.sourcesOk} Quellen ok, ` +
        `${scan.sourcesFailed} fehlgeschlagen, ${scan.itemsNew} neue Meldungen`,
    );

    if (scan.itemsNew > 0) {
      const p = await runProcess({});
      console.log(
        `[${stamp()}] #${n} Bewertung: ${p.itemsSentToModel} ans Modell, ` +
          `${p.signalsCreated} Signale, $${p.llmCostUsd.toFixed(4)}` +
          (p.haltedOnBudget ? "  (Tagesbudget erreicht)" : ""),
      );
    }
  } catch (err) {
    // A failed cycle is logged and the loop continues — a transient network
    // error at 3am must not end the night's collection.
    console.error(`[${stamp()}] #${n} Durchlauf fehlgeschlagen:`, err);
  }
}

async function main() {
  console.log(
    `Signal Desk Daemon — Scan + Bewertung alle ${INTERVAL_MS / 60000} Minuten. Ctrl+C beendet.\n`,
  );
  for (let n = 1; !stopping; n++) {
    await cycle(n);
    if (stopping) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log("Beendet.");
  process.exit(0);
}

main();
