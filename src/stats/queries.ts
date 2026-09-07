import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * The scorecard queries.
 *
 * Every breakdown here reports its sample size next to its hit rate, and none
 * of them hide a small one. A 100% hit rate on three signals is the single
 * most misleading number this page could produce, so `n` is never optional and
 * the page marks anything below MIN_RELIABLE_N as provisional rather than
 * quietly dropping it — a hidden row looks like an absence of evidence.
 *
 * Neutral signals are excluded from every hit-rate figure. They make no
 * directional claim, so counting them as right or wrong would be scoring a
 * prediction the tool never made. They still appear in the volume counts.
 */

/** Below this, a rate is noise. Chosen to be honest, not flattering. */
export const MIN_RELIABLE_N = 10;

async function rows<T>(statement: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db().execute(statement)) as unknown as
    | T[]
    | { rows: T[] };
  return Array.isArray(result) ? result : (result.rows ?? []);
}

const n = (v: unknown): number => Number(v ?? 0);
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type Overview = {
  signalsTotal: number;
  signalsModel: number;
  signalsRules: number;
  measured: number;
  pending: number;
  hitRate5d: number | null;
  avgReturn5d: number | null;
  costTotalUsd: number;
  costTodayUsd: number;
};

export async function overview(): Promise<Overview> {
  const [s] = await rows<Record<string, unknown>>(sql`
    select
      count(*)                                        as signals_total,
      count(*) filter (where model <> 'rules')        as signals_model,
      count(*) filter (where model =  'rules')        as signals_rules
    from signals`);

  const [o] = await rows<Record<string, unknown>>(sql`
    select
      count(*) filter (where direction_correct_5d is not null) as measured,
      count(*) filter (where direction_correct_5d is null)     as pending,
      avg(case when direction_correct_5d then 1.0 else 0.0 end)
        filter (where direction_correct_5d is not null)        as hit_rate,
      avg(return_5d) filter (where return_5d is not null)      as avg_return
    from signal_outcomes`);

  const [c] = await rows<Record<string, unknown>>(sql`
    select
      coalesce(sum(cost_usd), 0) as total,
      coalesce(sum(cost_usd) filter (
        where created_at >= date_trunc('day', now() at time zone 'utc')), 0) as today
    from llm_usage`);

  return {
    signalsTotal: n(s?.signals_total),
    signalsModel: n(s?.signals_model),
    signalsRules: n(s?.signals_rules),
    measured: n(o?.measured),
    pending: n(o?.pending),
    hitRate5d: maybe(o?.hit_rate),
    avgReturn5d: maybe(o?.avg_return),
    costTotalUsd: n(c?.total),
    costTodayUsd: n(c?.today),
  };
}

export type Breakdown = {
  label: string;
  signals: number;
  measured: number;
  hitRate: number | null;
  avgReturn5d: number | null;
};

/**
 * Shared shape for every "hit rate by X" table.
 *
 * `signals` counts all signals in the bucket while `measured` counts only
 * those with a settled +5 day return. Showing both makes the gap between
 * "how much this bucket produces" and "how much of it we can actually judge"
 * visible, which is the difference between a scorecard and a vanity metric.
 */
async function breakdown(
  groupExpr: ReturnType<typeof sql>,
  join: ReturnType<typeof sql>,
): Promise<Breakdown[]> {
  return (
    await rows<Record<string, unknown>>(sql`
      select
        ${groupExpr} as label,
        count(*)                                      as signals,
        count(o.direction_correct_5d)                 as measured,
        /*
         * The FILTER is not optional. Without it the CASE sends every
         * not-yet-measured signal down the ELSE branch and counts it as
         * WRONG, so a bucket of 90 pending signals and 10 correct ones
         * reports an 11% hit rate instead of 100%. The number looks
         * plausible, which is what makes the mistake dangerous.
         */
        avg(case when o.direction_correct_5d then 1.0 else 0.0 end)
          filter (where o.direction_correct_5d is not null)  as hit_rate,
        avg(o.return_5d)                              as avg_return
      from signals s
      left join signal_outcomes o on o.signal_id = s.id
      ${join}
      where s.direction <> 'neutral'
      group by 1
      having count(*) > 0
      order by count(o.direction_correct_5d) desc, count(*) desc
      limit 25`)
  ).map((r) => ({
    label: String(r.label ?? "—"),
    signals: n(r.signals),
    measured: n(r.measured),
    hitRate: maybe(r.hit_rate),
    avgReturn5d: maybe(r.avg_return),
  }));
}

export function byEventType(): Promise<Breakdown[]> {
  return breakdown(sql`s.event_type::text`, sql``);
}

export function bySource(): Promise<Breakdown[]> {
  return breakdown(
    sql`src.name`,
    sql`join items i on i.id = s.item_id join sources src on src.id = i.source_id`,
  );
}

export function byModel(): Promise<Breakdown[]> {
  return breakdown(sql`s.model || ' / ' || s.prompt_version`, sql``);
}

/**
 * Confidence buckets.
 *
 * The whole point of asking a model for a confidence is that it should mean
 * something: 0.8 signals ought to be right more often than 0.4 signals. This
 * table is where that either shows up or does not, and it is the one to read
 * before trusting any other number on the page.
 */
export function byConfidence(): Promise<Breakdown[]> {
  return breakdown(
    sql`case
          when s.confidence >= 0.8 then '0.8 – 1.0  (high)'
          when s.confidence >= 0.6 then '0.6 – 0.8'
          when s.confidence >= 0.4 then '0.4 – 0.6'
          else                          'below 0.4  (low)'
        end`,
    sql``,
  );
}

export type DailyRow = {
  day: string;
  signals: number;
  costUsd: number;
};

/** Volume and spend, last 14 days, so a runaway cost is visible immediately. */
export async function daily(): Promise<DailyRow[]> {
  return (
    await rows<Record<string, unknown>>(sql`
      with days as (
        select generate_series(
          (now() at time zone 'utc')::date - interval '13 days',
          (now() at time zone 'utc')::date,
          interval '1 day')::date as day
      )
      select
        d.day::text                                as day,
        coalesce(sg.c, 0)                          as signals,
        coalesce(u.cost, 0)                        as cost_usd
      from days d
      left join (
        select created_at::date as day, count(*) as c
        from signals group by 1) sg on sg.day = d.day
      left join (
        select created_at::date as day, sum(cost_usd) as cost
        from llm_usage group by 1) u on u.day = d.day
      order by d.day`)
  ).map((r) => ({
    day: String(r.day),
    signals: n(r.signals),
    costUsd: n(r.cost_usd),
  }));
}
