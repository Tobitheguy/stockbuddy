import type { VercelConfig } from "@vercel/config/v1";

/**
 * Scheduled jobs.
 *
 * Times are UTC — Vercel Cron has no timezone setting, so every schedule here
 * is written in UTC and the New York offset is stated in the comment. Getting
 * this wrong is silent: the job still runs, just at the wrong point in the
 * trading day.
 *
 * The three jobs are staggered rather than sharing a minute. They contend for
 * the same database and the same daily LLM budget, and a scan that overlaps
 * its own previous run re-polls feeds that cannot have changed.
 */
export const config: VercelConfig = {
  crons: [
    /*
     * Ingest every 10 minutes. Per-source poll intervals still apply inside
     * the run, so a feed that only updates hourly is not fetched six times an
     * hour — this is the upper bound on freshness, not the fetch rate.
     */
    { path: "/api/scan", schedule: "*/10 * * * *" },

    /*
     * Score five minutes after each scan, so a run reads items the scan has
     * finished writing rather than racing it.
     */
    { path: "/api/process", schedule: "5-59/10 * * * *" },

    /*
     * Closes at 21:30 UTC — 17:30 New York, an hour after the bell: late
     * enough for the provider to have settled the official close, early enough
     * to stay clear of the next session.
     *
     * Weekdays only. A weekend run has no new close to record and would write
     * a price gap for every tracked symbol — the exact state the outcomes job
     * reads as "our fetch failed, do not measure".
     */
    { path: "/api/prices", schedule: "30 21 * * 1-5" },

    /*
     * Measurement 30 minutes later, against whatever closes are stored. The
     * gap is fixed rather than chained so a slow price run delays the
     * scorecard by a day at worst, instead of racing it.
     */
    { path: "/api/outcomes", schedule: "0 22 * * 1-5" },
  ],
};

export default config;
