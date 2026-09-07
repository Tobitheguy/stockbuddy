import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { syncEarningsCalendar } from "@/market/earnings";
import { refreshPrices } from "@/market/refresh";

/**
 * GET/POST /api/prices — record today's closes.
 *
 * Separate from /api/outcomes because the two have completely different time
 * profiles: this one is bound by the price API's rate limit and can run for
 * minutes, while measuring is pure database work and finishes in seconds.
 * Sharing one invocation would let a slow fetch eat the measurement's budget.
 */

export const dynamic = "force-dynamic";

/**
 * Vercel Pro allows up to 800s. The refresh stops itself well before this
 * (see the deadline below) so it can close its run row and report what is
 * left, rather than being killed mid-symbol.
 */
export const maxDuration = 800;

/** Leave 60s of headroom for the final database writes and the response. */
const SOFT_DEADLINE_MS = 740_000;

async function handle(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const summary = await refreshPrices({ deadlineMs: SOFT_DEADLINE_MS });
    // Earnings dates ride along with the daily price run: same provider, same
    // rate budget, and the watchlist is small enough that this adds seconds.
    const earnings = await syncEarningsCalendar().catch((err) => {
      console.error("[prices] earnings sync failed:", err);
      return { symbols: 0, stored: 0 };
    });
    return NextResponse.json({ ...summary, earnings }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[prices] run failed:", err);
    return NextResponse.json(
      { error: "Price refresh failed", detail: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
