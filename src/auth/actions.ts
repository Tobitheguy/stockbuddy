"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "./users";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
} from "./session";

/**
 * Sign-in and sign-out.
 *
 * Accounts are rows in `users`, each with its own scrypt hash. ADMIN_EMAIL and
 * ADMIN_PASSWORD_HASH seed the first row on first use, so a deployment that
 * only ever had those keeps working without any migration step.
 */

/**
 * In-process throttle on failed attempts.
 *
 * A single scrypt verification takes ~100ms at these parameters, which already
 * makes brute force impractical, but it also means an attacker can pin a
 * serverless instance's CPU with concurrent guesses. Counting failures caps
 * both. State is per-instance and resets on redeploy — acceptable for a
 * one-user tool, and deliberately not a database write, which would hand an
 * unauthenticated caller a way to generate load.
 */
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
let failures = 0;
let lockedUntil = 0;

export type LoginState = { error: string | null };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (Date.now() < lockedUntil) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60_000);
    return { error: `Too many attempts. Try again in ${minutes} minute(s).` };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // Accounts live in the database now; ADMIN_EMAIL / ADMIN_PASSWORD_HASH seed
  // the first row on first use, so an existing deployment is unaffected.
  let user: Awaited<ReturnType<typeof authenticate>>;
  try {
    user = await authenticate(email, password);
  } catch (err) {
    // A misconfigured deployment must fail closed and say why — not fall back
    // to letting anyone in, and not show a generic error that sends the owner
    // hunting for a wrong password that was never the problem.
    console.error("[auth] sign-in failed:", err);
    return {
      error:
        "Sign-in is unavailable — the account store could not be reached. " +
        "If this is a new deployment, set ADMIN_EMAIL and ADMIN_PASSWORD_HASH " +
        "(npm run set-password) or add a user with npm run users -- add.",
    };
  }

  if (!user) {
    failures++;
    if (failures >= MAX_FAILURES) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failures = 0;
    }
    return { error: "Wrong email or password." };
  }

  failures = 0;
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    sameSite: "lax",
    // Plain http on localhost would silently drop a Secure cookie, which looks
    // exactly like a login that "does nothing".
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const next = String(formData.get("next") ?? "");
  // Only same-origin paths. A value starting "//" is protocol-relative and
  // would leave the site, so it is rejected along with anything absolute.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(target);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
