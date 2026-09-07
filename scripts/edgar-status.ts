import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

/** Read-only health snapshot: corpus, scoring mode effects, price coverage. */
async function q(label: string, statement: ReturnType<typeof sql>) {
  const r = (await db().execute(statement)) as unknown as
    | Record<string, unknown>[]
    | { rows: Record<string, unknown>[] };
  console.log(`\n${label}`);
  console.table(Array.isArray(r) ? r : r.rows);
}

async function main() {
  await q(
    "EDGAR-Meldungen nach Status:",
    sql`select case when i.processed_at is null then 'offen' else 'verarbeitet' end as status,
               count(*) filter (where i.body_text is null) as ohne_text,
               count(*) filter (where i.body_text is not null) as mit_text,
               count(*) as gesamt
        from items i join sources s on s.id = i.source_id
        where s.kind = 'edgar' group by 1`,
  );
  await q(
    "Signale nach Modell:",
    sql`select model, count(*) as signale, round(avg(score), 1) as schnitt,
               max(score) as hoechster
        from signals group by 1 order by 2 desc`,
  );
  await q(
    "Preis-Abdeckung — wie viele Symbole der Tages-Job anfassen muss:",
    sql`select
          (select count(distinct symbol) from watchlist) as watchlist,
          (select count(distinct symbol) from signals
             where symbol is not null and created_at >= now() - interval '40 days') as signale_40t,
          (select count(distinct symbol) from prices) as mit_kursen`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
