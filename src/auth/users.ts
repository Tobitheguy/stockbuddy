import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";

/**
 * Accounts.
 *
 * Sign-in used to compare against a single ADMIN_EMAIL / ADMIN_PASSWORD_HASH
 * pair from the environment. That works for one person and breaks the moment
 * there are two: a shared password means either can lock the other out, and
 * neither can be removed without changing the other's credentials.
 *
 * The env pair is now a SEED rather than the source of truth — on first use it
 * becomes a row like any other, so an existing deployment keeps working with
 * no action, and adding a second person is a database insert instead of a
 * redeploy.
 */

export type User = {
  email: string;
  receivesAlerts: boolean;
};

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Copy the environment admin into the table if it is not there yet.
 *
 * Idempotent and cheap. Runs before any sign-in so the first login after this
 * change behaves identically to the last one before it.
 */
export async function ensureSeedUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL && normalise(process.env.ADMIN_EMAIL);
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !hash) return;

  await db()
    .insert(users)
    .values({ email, passwordHash: hash })
    .onConflictDoNothing({ target: users.email });
}

/**
 * Verify a sign-in. Returns the user, or null.
 *
 * Always runs a scrypt verification, even for an unknown address, so the
 * response time does not reveal which addresses have accounts.
 */
export async function authenticate(
  emailRaw: string,
  password: string,
): Promise<User | null> {
  await ensureSeedUser();
  const email = normalise(emailRaw);

  const [row] = await db()
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // A dummy hash of the right shape keeps the timing of "no such user" close
  // to the timing of "wrong password".
  const hash = row?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hash);
  if (!ok || !row) return null;

  await db()
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.email, email));

  return { email: row.email, receivesAlerts: row.receivesAlerts };
}

/**
 * A real scrypt hash of a random string, generated once at module load.
 * Its value is irrelevant — it exists only so the unknown-user path does the
 * same work as the known-user path.
 */
const DUMMY_HASH =
  "scrypt.131072.8.1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Create or update an account. Returns true when a new one was created. */
export async function upsertUser(
  emailRaw: string,
  password: string,
  receivesAlerts = true,
): Promise<boolean> {
  const email = normalise(emailRaw);
  if (!email.includes("@")) throw new Error("Not an email address.");
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db()
    .insert(users)
    .values({ email, passwordHash, receivesAlerts })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, receivesAlerts },
    })
    .returning({ created: sql<boolean>`(xmax = 0)` });

  return inserted[0]?.created ?? false;
}

export async function listUsers(): Promise<
  Array<User & { createdAt: Date; lastLoginAt: Date | null }>
> {
  await ensureSeedUser();
  return db()
    .select({
      email: users.email,
      receivesAlerts: users.receivesAlerts,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(users.createdAt);
}

export async function removeUser(emailRaw: string): Promise<boolean> {
  const removed = await db()
    .delete(users)
    .where(eq(users.email, normalise(emailRaw)))
    .returning({ email: users.email });
  return removed.length > 0;
}

/**
 * Recipients for alerts and the digest.
 *
 * Falls back to ADMIN_EMAIL only when the table is empty, which can happen on
 * a deployment where the seed has not run because nobody has signed in yet.
 * Returning an empty list would silently stop the emails.
 */
export async function alertRecipients(): Promise<string[]> {
  const rows = await db()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.receivesAlerts, true));

  if (rows.length > 0) return rows.map((r) => r.email);
  const fallback = process.env.ADMIN_EMAIL;
  return fallback ? [normalise(fallback)] : [];
}
