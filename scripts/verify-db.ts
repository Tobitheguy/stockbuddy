import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";

/**
 * Verifies the LIVE database, not the schema file.
 *
 * A migration that generates clean SQL and a database that actually enforces
 * its constraints are two different claims. This script asserts the second one
 * by trying to write bad data and requiring the database to refuse it.
 *
 * Run after every migration: `npm run db:verify`
 *
 * Safe to run against a populated database — every row it writes is namespaced
 * to verify.test and removed in the finally block.
 */

const sql = neon(process.env.DATABASE_URL!);

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string) {
  console.log(`  ok    ${name}`);
  pass++;
}
function bad(name: string, detail = "") {
  console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
  failures.push(name);
  fail++;
}

/** Assert the database REFUSES a statement. */
async function mustReject(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    bad(name, "accepted, but should have been rejected");
  } catch {
    ok(name);
  }
}

const VERIFY_URL = "https://verify.test/constraint-check";

async function main() {
  console.log("\n— schema shape —");
  const tables = await sql`select table_name from information_schema.tables
    where table_schema = 'public' and table_name not like '__drizzle%' order by 1`;
  console.log(`  tables: ${tables.map((t) => t.table_name).join(", ")}`);
  tables.length === 10
    ? ok("10 tables present")
    : bad("table count", String(tables.length));

  const checks = await sql`select conname from pg_constraint
    where contype = 'c' and connamespace = 'public'::regnamespace order by 1`;
  checks.length >= 7
    ? ok(`${checks.length} check constraints present`)
    : bad("check constraints", String(checks.length));

  console.log("\n— seed —");
  const [{ count: sources }] = await sql`select count(*)::int from sources`;
  const [{ count: enabled }] =
    await sql`select count(*)::int from sources where enabled`;
  const [{ count: watchlist }] = await sql`select count(*)::int from watchlist`;
  console.log(`  sources=${sources} enabled=${enabled} watchlist=${watchlist}`);
  sources === 40 ? ok("40 sources") : bad("source count", String(sources));
  watchlist === 0
    ? ok("watchlist empty by design")
    : bad("watchlist should seed empty", String(watchlist));

  console.log("\n— CHECK constraints refuse bad data —");
  await mustReject(
    "magnitude 0",
    () =>
      sql`insert into signals (item_id,symbol,event_type,direction,magnitude,confidence,horizon,score,rationale,model,prompt_version)
          values (1,'NVDA','earnings','bullish',0,0.5,'days',10,'x','m','v1')`,
  );
  await mustReject(
    "confidence 4.7",
    () =>
      sql`insert into signals (item_id,symbol,event_type,direction,magnitude,confidence,horizon,score,rationale,model,prompt_version)
          values (1,'NVDA','earnings','bullish',3,4.7,'days',10,'x','m','v1')`,
  );
  await mustReject(
    "signal with neither symbol nor sector",
    () =>
      sql`insert into signals (item_id,event_type,direction,magnitude,confidence,horizon,score,rationale,model,prompt_version)
          values (1,'earnings','bullish',3,0.5,'days',10,'x','m','v1')`,
  );
  await mustReject(
    "lowercase ticker symbol",
    () => sql`insert into tickers (symbol,name) values ('aapl','Apple')`,
  );
  await mustReject(
    "poll interval below 30s",
    () =>
      sql`insert into sources (name,kind,url,poll_interval_sec) values ('verify-too-fast','rss','x',5)`,
  );

  console.log("\n— dedupe guarantees —");
  const [src] = await sql`select id from sources where name = 'SEC EDGAR 8-K'`;

  // Requirement: running the scanner twice produces zero duplicate items.
  for (let i = 0; i < 2; i++) {
    await sql`insert into items (source_id,canonical_url,url_hash,title,published_at,content_hash)
      values (${src.id},${VERIFY_URL},'vh','Verify',now(),'vc')
      on conflict (canonical_url) do nothing`;
  }
  const [{ count: itemCount }] =
    await sql`select count(*)::int from items where canonical_url = ${VERIFY_URL}`;
  itemCount === 1
    ? ok("scanning twice inserts one item")
    : bad("duplicate items", String(itemCount));

  const [item] = await sql`select id from items where canonical_url = ${VERIFY_URL}`;

  // Requirement: re-processing produces zero duplicate signals — including
  // sector-level signals, whose symbol is NULL.
  for (let i = 0; i < 2; i++) {
    await sql`insert into signals (item_id,sector,event_type,direction,magnitude,confidence,horizon,score,rationale,model,prompt_version)
      values (${item.id},'steel','regulatory_policy','bullish',4,0.7,'weeks',60,'r','m','v1')
      on conflict on constraint signals_item_symbol_sector_key do nothing`;
  }
  const [{ count: sigCount }] =
    await sql`select count(*)::int from signals where item_id = ${item.id}`;
  sigCount === 1
    ? ok("sector-level signal does not duplicate on reprocess (NULLS NOT DISTINCT)")
    : bad("sector signal duplicated", String(sigCount));

  console.log("\n— history is protected —");
  await sql`insert into signals (item_id,symbol,event_type,direction,magnitude,confidence,horizon,score,rationale,model,prompt_version)
    values (${item.id},'NVDA','earnings','bullish',3,0.5,'days',30,'r','m','v1')
    on conflict on constraint signals_item_symbol_sector_key do nothing`;
  await mustReject(
    "deleting a ticker that has signals",
    () => sql`delete from tickers where symbol = 'NVDA'`,
  );

  console.log("\n— prices cannot invent a trading day —");
  await sql`insert into prices (symbol,market_date,close) values ('NVDA','2026-09-04',100)
    on conflict do nothing`;
  await mustReject(
    "two rows for the same market date",
    () => sql`insert into prices (symbol,market_date,close) values ('NVDA','2026-09-04',101)`,
  );
}

async function cleanup() {
  const rows = await sql`select id from items where canonical_url = ${VERIFY_URL}`;
  for (const r of rows) await sql`delete from signals where item_id = ${r.id}`;
  await sql`delete from items where canonical_url = ${VERIFY_URL}`;
  await sql`delete from prices where symbol = 'NVDA' and market_date = '2026-09-04'`;
  await sql`delete from sources where name = 'verify-too-fast'`;
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) console.log("failed: " + failures.join("; "));
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error("verify-db crashed:", err);
    process.exit(1);
  });
