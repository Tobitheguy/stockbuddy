import { NextResponse, type NextRequest } from "next/server";
import { publicReadOnly } from "@/auth/public-mode";
import { SESSION_COOKIE, verifySession } from "@/auth/session";

/**
 * Everything behind a login except the login page itself.
 *
 * Deny by default. The matcher below excludes static assets and the login
 * route; anything else added to the app later is protected without anyone
 * having to remember to protect it. A gate built the other way round — an
 * allowlist of private pages — fails silently the first time a page is added,
 * and the failure mode is a public watchlist.
 *
 * `/api/*` is excluded here because those routes authenticate differently:
 * they are called by cron with a CRON_SECRET bearer token, not by a browser
 * holding a cookie. They enforce that themselves.
 *
 * PUBLIC_READ_ONLY relaxes this for GET and HEAD only. Server Actions are
 * POSTs to the page path — they pass through this same matcher — so gating on
 * the method is what keeps "anyone may look" from becoming "anyone may edit".
 * That is also why an unauthenticated write gets a flat 403 rather than the
 * redirect a browser navigation gets: an action is not a navigation, and
 * answering it with a login page would have it parsed as a result.
 */

const PUBLIC_PATHS = new Set(["/login"]);

/** Methods that cannot change anything, per RFC 9110. */
const READ_METHODS = new Set(["GET", "HEAD"]);

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (publicReadOnly()) {
    if (READ_METHODS.has(request.method)) return NextResponse.next();
    return new NextResponse("Read-only: sign in to change anything.", {
      status: 403,
    });
  }

  const login = new URL("/login", request.url);
  // Round-trip the original destination so a bookmarked ticker page still
  // lands where it was pointed after signing in. Only the path and query are
  // carried, never a full URL, so this cannot be turned into an open redirect.
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api            — bearer-token authenticated, see above
     *   _next/static   — build output
     *   _next/image    — image optimiser
     *   favicon/icons  — requested before any session exists
     */
    "/((?!api/|_next/static|_next/image|favicon\\.ico|icon\\.|apple-icon\\.|robots\\.txt|sitemap\\.xml).*)",
  ],
};
