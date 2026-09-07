import { sql, type SQL } from "drizzle-orm";

/**
 * The score, decayed against the current clock, as SQL.
 *
 * This mirrors `recencyDecay` and `computeScore` in src/scoring.ts, and the
 * two must not drift — there is a test that evaluates this expression against
 * the TypeScript implementation on the same inputs and requires them to agree.
 *
 * It is SQL rather than a post-fetch map because it is what ORDER BY and LIMIT
 * need. Sorting in JavaScript would mean fetching every signal ever written to
 * find today's top twenty, and it would put the paging arithmetic on the wrong
 * side of the database.
 *
 * Falls back to the stored `score` when `base_score` is null, so rows written
 * before the column existed still rank sensibly instead of dropping to zero.
 */

/** Must match HALF_LIFE_HOURS in src/scoring.ts. */
const HALF_LIFE_SQL = sql`case ${sql.raw("signals.horizon")}
    when 'days'   then 36.0
    when 'weeks'  then 168.0
    when 'months' then 720.0
    else 72.0
  end`;

export function liveScore(): SQL<number> {
  return sql<number>`
    coalesce(${sql.raw("signals.base_score")}, ${sql.raw("signals.score")})
    * power(
        0.5,
        /* Both clamps are load-bearing.
           greatest(...,0) mirrors the future-timestamp guard in recencyDecay:
           feeds do publish them, and a negative age would raise the power
           above 1 and let a mis-stamped item outrank everything real.
           least(...,8760) caps the age at a year. Postgres numeric has no
           underflow, so power(0.5, 1660) returns a literal 500-digit
           fraction — one USASpending award carrying a 1978 date was enough to
           blow up any query that cast the result to a float. A year of decay
           is already indistinguishable from zero for ranking. */
        least(
          greatest(
            extract(epoch from (now() - ${sql.raw("items.published_at")})) / 3600.0,
            0
          ),
          8760
        ) / ${HALF_LIFE_SQL}
      )`;
}
