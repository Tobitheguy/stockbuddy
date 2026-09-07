import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

/** The current top of the feed, with the score's inputs broken out. */
async function main() {
  const r = (await db().execute(sql`
    select sg.score, sg.symbol, sg.sector, sg.direction, sg.magnitude,
           sg.confidence, sg.horizon, sg.event_type, src.quality_weight,
           round(extract(epoch from (now() - i.published_at)) / 3600) as alter_h,
           left(sg.rationale, 110) as begruendung
    from signals sg
    join items i on i.id = sg.item_id
    join sources src on src.id = i.source_id
    where sg.model <> 'rules'
    order by sg.score desc
    limit 12`)) as unknown as Record<string, unknown>[] | { rows: Record<string, unknown>[] };

  const rows = Array.isArray(r) ? r : r.rows;
  for (const x of rows) {
    console.log(
      `${String(Number(x.score).toFixed(1)).padStart(5)}  ` +
        `${String(x.symbol ?? x.sector).slice(0, 22).padEnd(22)} ` +
        `${String(x.direction).padEnd(8)} mag ${x.magnitude}  conf ${x.confidence}  ` +
        `Quelle ${x.quality_weight}  ${x.alter_h}h alt  ${x.event_type}`,
    );
    console.log(`       ${x.begruendung}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
