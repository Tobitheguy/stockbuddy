import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token gate for the cron-triggered routes.
 *
 * These routes cost money (model calls) and cause outbound traffic to sources
 * that rate-limit us, so an open endpoint is both a billing and a
 * get-us-blocked risk.
 */

export type AuthResult = { ok: true } | { ok: false; status: 401 | 500; message: string };

export function checkCronAuth(request: Request): AuthResult {
  const expected = process.env.CRON_SECRET;

  if (!expected || expected.length < 16) {
    // Fail CLOSED. A missing secret must never mean "allow everyone" — that is
    // exactly the misconfiguration that leaves an endpoint open in production.
    return {
      ok: false,
      status: 500,
      message: "CRON_SECRET is not configured on the server.",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return { ok: false, status: 401, message: "Missing bearer token." };
  }

  const provided = header.slice(prefix.length).trim();

  // Constant-time compare. Length is compared first because timingSafeEqual
  // throws on differing lengths — and length alone is not a useful secret.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Invalid bearer token." };
  }

  return { ok: true };
}

/**
 * Vercel Cron invokes the route with `Authorization: Bearer $CRON_SECRET`
 * automatically when CRON_SECRET is set on the project, so the same check
 * covers both the scheduler and a manual curl.
 */
