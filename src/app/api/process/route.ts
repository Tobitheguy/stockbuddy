import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runProcess } from "@/ingest/process";

/**
 * GET/POST /api/process — turn ingested items into signals.
 *
 * Separate from /api/scan on purpose: fetching and scoring fail for different
 * reasons and have very different cost profiles. A model outage must not stop
 * ingestion, and a blocked feed must not stop scoring the backlog.
 */
export const dynamic = "force-dynamic";

/**
 * Scoring is the slow job: roughly eight seconds per item through triage plus
 * Opus, so a batch of seventy takes ten minutes. At the previous 300s the
 * function was killed mid-loop on every busy run, leaving an unfinished run
 * row and no record of what had been spent.
 */
export const maxDuration = 800;

/**
 * Stop before the NEXT scheduled run starts, not merely before the platform
 * limit. The cron fires every ten minutes; a run allowed to reach 800s would
 * still be scoring when its successor began, and two runs pulling the same
 * queue would pay a model twice for the same item before either marked it
 * processed. 540s leaves a minute of margin either side.
 */
const SOFT_DEADLINE_MS = 540_000;

async function handle(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(2000, Number(limitParam) || 0) : undefined;

  try {
    const summary = await runProcess({ limit, deadlineMs: SOFT_DEADLINE_MS });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[process] run failed:", err);
    return NextResponse.json(
      { error: "Process failed", detail: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

/**
 * Vercel Cron invokes scheduled paths with GET, so GET must do the work rather
 * than return 405 — an earlier version of this file rejected it, which would
 * have left every scheduled run failing with a 405 in the logs while the app
 * itself looked healthy. The bearer check is what keeps it closed, not the
 * HTTP verb.
 */
export const GET = handle;
export const POST = handle;
