import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runScan } from "../src/ingest/scan";

/**
 * Run one scan cycle from the command line: `npm run scan`
 *
 * Same code path the cron route uses, minus the HTTP layer — so it can be run
 * locally without needing CRON_SECRET.
 *
 * Pass --force to ignore per-source poll intervals.
 */
const force = process.argv.includes("--force");

runScan({ force })
  .then((s) => {
    console.log(
      `\nrun #${s.runId}  ${(s.durationMs / 1000).toFixed(1)}s  ` +
        `ok=${s.sourcesOk} failed=${s.sourcesFailed} skipped=${s.sourcesSkipped}  ` +
        `new=${s.itemsNew} prefiltered=${s.itemsPrefiltered}\n`,
    );

    const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
    console.log(
      pad("SOURCE", 36) + pad("STATUS", 9) + "FETCH  NEW  FILT   MS",
    );
    for (const o of s.outcomes) {
      console.log(
        pad(o.source, 36) +
          pad(o.ok ? "ok" : "FAILED", 9) +
          String(o.fetched).padStart(5) +
          String(o.inserted).padStart(5) +
          String(o.prefiltered).padStart(6) +
          String(o.durationMs).padStart(6),
      );
      for (const w of o.warnings) console.log(`      warn: ${w}`);
      if (o.error) console.log(`      error: ${o.error}`);
    }

    const failed = s.outcomes.filter((o) => !o.ok);
    if (failed.length) {
      console.log(
        `\n${failed.length} source(s) failed. The run still completed — that is the contract.`,
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("scan crashed:", err);
    process.exit(1);
  });
