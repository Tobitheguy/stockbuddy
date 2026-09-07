import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runProcess } from "../src/ingest/process";

/** Run one processing batch: `npm run process -- --limit 500` */
const idx = process.argv.indexOf("--limit");
const limit = idx > -1 ? Number(process.argv[idx + 1]) : undefined;

runProcess({ limit })
  .then((s) => {
    console.log(
      `\nrun #${s.runId}  mode=${s.mode}  ${(s.durationMs / 1000).toFixed(1)}s\n` +
        `  items considered : ${s.itemsConsidered}\n` +
        `  matched a ticker : ${s.itemsWithTickers}\n` +
        `  signals created  : ${s.signalsCreated}\n` +
        `  llm cost         : $${s.llmCostUsd.toFixed(4)}\n`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("process crashed:", err);
    process.exit(1);
  });
