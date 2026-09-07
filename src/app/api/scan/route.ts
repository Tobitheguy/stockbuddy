import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runScan } from "@/ingest/scan";

/**
 * POST /api/scan — one ingestion cycle.
 *
 * Triggered by Vercel Cron, or manually with:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/scan
 *
 * Pass ?force=1 to ignore per-source poll intervals (useful when testing;
 * wasteful otherwise, since it re-polls feeds that cannot have changed).
 */

// This route talks to the database and the open internet on every call, so it
// must never be prerendered or cached.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status },
    );
  }

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const summary = await runScan({ force });
    return NextResponse.json(summary, {
      // A partially failed scan is still a successful request — the per-source
      // outcomes carry the detail. Returning 500 here would make Vercel Cron
      // retry a run that mostly worked.
      status: 200,
    });
  } catch (err) {
    // Only a total failure (database unreachable, for example) lands here.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan] run failed:", err);
    return NextResponse.json(
      { error: "Scan failed", detail: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

/** GET returns 405 so a browser visit cannot trigger a scan by accident. */
export async function GET() {
  return NextResponse.json(
    { error: "Use POST with an Authorization: Bearer header." },
    { status: 405 },
  );
}
