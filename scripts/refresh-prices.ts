import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { refreshPrices } from "../src/market/refresh";

/** Daily close refresh: `npm run prices -- --limit 5` */
const i = process.argv.indexOf("--limit");
const limit = i > -1 ? Number(process.argv[i + 1]) : undefined;

refreshPrices({ limit })
  .then((s) => {
    console.log(
      `\nrun #${s.runId}  market date ${s.marketDate}  ${(s.durationMs / 1000).toFixed(1)}s\n` +
        `  symbols tracked : ${s.symbols}\n` +
        `  closes stored   : ${s.stored}\n` +
        `  gaps recorded   : ${s.gaps}\n`,
    );
    for (const f of s.failures.slice(0, 10)) {
      console.log(`  gap: ${f.symbol} — ${f.reason}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("refresh-prices crashed:", err);
    process.exit(1);
  });
