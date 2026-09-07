import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runProcess } from "@/ingest/process";

/**
 * POST /api/process — turn ingested items into signals.
 *
 * Separate from /api/scan on purpose: fetching and scoring fail for different
 * reasons and have very different cost profiles. A model outage must not stop
 * ingestion, and a blocked feed must not stop scoring the backlog.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(2000, Number(limitParam) || 0) : undefined;

  try {
    const summary = await runProcess({ limit });
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

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with an Authorization: Bearer header." },
    { status: 405 },
  );
}
