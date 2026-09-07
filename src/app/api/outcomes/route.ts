import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runOutcomes } from "@/market/outcomes";

/**
 * GET/POST /api/outcomes — measure open signals against stored closes.
 *
 * Reads prices, never fetches them. /api/prices runs first on a fixed schedule
 * and this runs afterwards, so the ordering is a stated 30-minute gap rather
 * than a race between two jobs of unpredictable length. Measuring against
 * yesterday's closes is a bounded, visible error; measuring against a
 * half-written price table is not.
 *
 * Manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/outcomes
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const outcomes = await runOutcomes();
    return NextResponse.json(outcomes, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[outcomes] run failed:", err);
    return NextResponse.json(
      { error: "Outcomes run failed", detail: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

// Vercel Cron issues a GET. POST is kept for manual invocation and symmetry
// with the other jobs.
export const GET = handle;
export const POST = handle;
