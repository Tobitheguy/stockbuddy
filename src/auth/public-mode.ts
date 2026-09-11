/**
 * Public read-only mode.
 *
 * The tool is private by default. These two flags open it for people who need
 * to look at it without an account — a reviewer, an interviewer — without
 * handing them the ability to change anything.
 *
 * Kept free of `next/headers` on purpose: `proxy.ts` imports this, and
 * middleware cannot read the request-scoped cookie store. Anything that needs
 * to know about the *current viewer* lives in ./viewer instead.
 *
 * Both default to off, so a deployment that never sets them behaves exactly as
 * it did before this file existed. A flag that fails open is not a flag.
 */

function enabled(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/**
 * Let anyone read the app without signing in.
 *
 * Read means read: `proxy.ts` admits GET and HEAD only, and every mutation
 * re-checks for a real session regardless of what the proxy let through.
 */
export function publicReadOnly(): boolean {
  return enabled(process.env.PUBLIC_READ_ONLY);
}

/**
 * Show which watchlist entries are actually held, to signed-out visitors.
 *
 * Separate from the flag above because it is a different question. Opening the
 * app discloses what the tool does; this discloses what its owner owns. The
 * watchlist reads perfectly well without it — entry prices and the return
 * since you added a symbol are the interesting part — so it stays off unless
 * someone deliberately turns it on.
 */
export function publicPositionsVisible(): boolean {
  return enabled(process.env.PUBLIC_SHOW_POSITIONS);
}
