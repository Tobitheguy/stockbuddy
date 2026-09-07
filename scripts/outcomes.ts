import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runOutcomes } from "../src/market/outcomes";
import { refreshPrices } from "../src/market/refresh";

/**
 * Daily scorecard job: `npm run outcomes [-- --skip-prices]`
 *
 * --skip-prices measures against closes already stored, without polling the
 * price API. Useful for re-running the measurement after a code change.
 */
const skipPrices = process.argv.includes("--skip-prices");

async function main() {
  if (!skipPrices) {
    const p = await refreshPrices();
    console.log(
      `Preise: ${p.stored} Schlusskurse gespeichert, ${p.gaps} Luecken, ` +
        `Handelstag ${p.marketDate}`,
    );
  }

  const o = await runOutcomes();
  console.log(
    `\nLauf #${o.runId}  ${(o.durationMs / 1000).toFixed(1)}s\n` +
      `  offene Signale geprueft : ${o.considered}\n` +
      `  Einstiegspreis gesetzt  : ${o.baselinesSet}\n` +
      `  aktualisiert            : ${o.updated}\n` +
      `  fertig gemessen (+20d)  : ${o.finalised}\n` +
      `  ohne Einstiegspreis     : ${o.skippedNoBaseline}\n` +
      `  wegen Preisluecke offen : ${o.skippedOpenGap}\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("outcomes crashed:", err);
  process.exit(1);
});
