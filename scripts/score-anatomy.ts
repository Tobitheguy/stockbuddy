import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

/**
 * Where the score actually goes.
 *
 * The score is a product of four factors, each at most 1. That makes it very
 * easy for a number to look damning without any single input being wrong, so
 * this prints the distribution of each factor separately rather than arguing
 * about the total.
 */
async function q(label: string, statement: ReturnType<typeof sql>) {
  const r = (await db().execute(statement)) as unknown as
    | Record<string, unknown>[]
    | { rows: Record<string, unknown>[] };
  console.log(`\n${label}`);
  console.table(Array.isArray(r) ? r : r.rows);
}

async function main() {
  await q(
    "Score-Verteilung (nur modellbewertete Signale):",
    sql`select width_bucket(score, 0, 100, 10) * 10 - 5 as bereich_mitte,
               count(*) as anzahl
        from signals where model <> 'rules' group by 1 order by 1`,
  );

  await q(
    "Magnitude — wie gross das Modell die Wirkung einschaetzt:",
    sql`select magnitude, count(*) as anzahl,
               round(100.0 * count(*) / sum(count(*)) over (), 1) as prozent
        from signals where model <> 'rules' group by 1 order by 1`,
  );

  await q(
    "Confidence — wie sicher sich das Modell ist:",
    sql`select case
                 when confidence >= 0.8 then '0.8+'
                 when confidence >= 0.6 then '0.6-0.8'
                 when confidence >= 0.4 then '0.4-0.6'
                 else 'unter 0.4' end as bereich,
               count(*) as anzahl,
               round(100.0 * count(*) / sum(count(*)) over (), 1) as prozent
        from signals where model <> 'rules' group by 1 order by 1 desc`,
  );

  await q(
    "Quellengewicht — der Faktor, den NICHT das Modell setzt:",
    sql`select src.quality_weight as gewicht, count(*) as signale,
               count(distinct src.name) as quellen,
               string_agg(distinct src.name, ', ') as namen
        from signals sg
        join items i on i.id = sg.item_id
        join sources src on src.id = i.source_id
        where sg.model <> 'rules'
        group by 1 order by 1 desc`,
  );

  await q(
    "Rechnerische Obergrenze je Faktor (Median und Maximum):",
    sql`select
          round(avg(sg.magnitude / 5.0), 2)      as mag_schnitt,
          max(sg.magnitude / 5.0)                as mag_max,
          round(avg(sg.confidence), 2)           as conf_schnitt,
          max(sg.confidence)                     as conf_max,
          round(avg(src.quality_weight), 2)      as quelle_schnitt,
          max(src.quality_weight)                as quelle_max,
          round(avg(sg.score), 1)                as score_schnitt,
          max(sg.score)                          as score_max
        from signals sg
        join items i on i.id = sg.item_id
        join sources src on src.id = i.source_id
        where sg.model <> 'rules'`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
