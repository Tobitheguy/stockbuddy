import { cookies } from "next/headers";
import { publicPositionsVisible, publicReadOnly } from "./public-mode";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Who is looking at this request, and what they are allowed to see or do.
 *
 * Pages call `viewer()` once and pass the answer down as props. The alternative
 * — every component reaching for the cookie itself — would make "is this
 * control safe to render" a question answered in a dozen places, which is how
 * one of them ends up answering it wrong.
 *
 * Rendering is not the security boundary. Hiding a button stops nobody from
 * POSTing to the action behind it; `proxy.ts` and the guard in
 * `src/app/actions.ts` do that. This type exists so the UI does not *offer*
 * what it would then have to refuse.
 */

export type Viewer = {
  /** A valid session cookie was presented. */
  signedIn: boolean;
  /** May change data. True only when signed in. */
  canWrite: boolean;
  /** May see which watchlist rows are real holdings. */
  seesPositions: boolean;
  /** Reading without an account, because PUBLIC_READ_ONLY is on. */
  isPublicVisitor: boolean;
};

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export async function viewer(): Promise<Viewer> {
  if (await isSignedIn()) {
    return {
      signedIn: true,
      canWrite: true,
      seesPositions: true,
      isPublicVisitor: false,
    };
  }

  // Reaching here without PUBLIC_READ_ONLY means the proxy is misconfigured:
  // it should have redirected to /login. Answer as restrictively as possible
  // rather than assuming that cannot happen.
  return {
    signedIn: false,
    canWrite: false,
    seesPositions: publicPositionsVisible(),
    isPublicVisitor: publicReadOnly(),
  };
}
