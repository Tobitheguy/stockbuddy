import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Database handle.
 *
 * Uses the neon-http driver, which speaks HTTP rather than holding a TCP
 * connection. That is the right choice on Vercel: a serverless function can be
 * frozen between invocations, and a pooled TCP connection left open across
 * freezes is how you exhaust Postgres connections without any traffic.
 *
 * The URL must be the POOLED Neon endpoint — the host containing "-pooler".
 */

let cached: ReturnType<typeof create> | null = null;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste the " +
        "Neon pooled connection string.",
    );
  }
  if (!url.includes("-pooler")) {
    // Not fatal — a direct connection works — but it is almost always a
    // mistake on serverless, so say so once rather than debugging connection
    // exhaustion later.
    console.warn(
      "[db] DATABASE_URL does not look like a pooled Neon endpoint " +
        "(no '-pooler' in the host). This will work locally but can exhaust " +
        "connections on Vercel.",
    );
  }
  return drizzle(neon(url), { schema });
}

/**
 * Lazily constructed so that importing this module never throws at build time.
 * Next.js evaluates route modules during `next build`, where DATABASE_URL is
 * legitimately absent; the error must surface on first use, not on import.
 */
export function db() {
  cached ??= create();
  return cached;
}

export { schema };
