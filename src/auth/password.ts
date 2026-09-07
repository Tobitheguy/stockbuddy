import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt.
 *
 * scrypt because it is in the Node standard library — no dependency, nothing
 * to keep patched — and it is memory-hard, so a leaked hash is expensive to
 * attack offline. The plaintext password is never stored anywhere: the
 * deployment holds only ADMIN_PASSWORD_HASH.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's scrypt baseline: N=2^17, r=8, p=1. */
const PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 32;

/**
 * Format: scrypt.N.r.p.<salt-b64url>.<hash-b64url>
 *
 * NOT the conventional `scrypt$N$r$...` — and the reason matters, because the
 * conventional form silently breaks here. This value lives in a .env file, and
 * Next's env loader runs variable expansion over those, so `$131072` and `$8`
 * are read as references to undefined variables and substituted away. An
 * 87-character hash arrived at the app as 25 characters, every login failed
 * with "wrong email or password", and nothing anywhere logged a problem — the
 * app was comparing against a corrupted value it had no way to recognise.
 *
 * Dots and base64url survive expansion untouched, so the encoding removes the
 * failure rather than documenting a workaround. Old `$`-separated hashes are
 * still accepted on verify, for anyone who generated one before this changed.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    PARAMS,
  );
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    b64url(salt),
    b64url(hash),
  ].join(".");
}

/** base64url: no "+", "/" or "=" to be mangled by a shell, URL or env parser. */
function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Never throws on a malformed stored value — a bad hash means "no match". */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // "$" first: a legacy hash never contains ".", and a new one never contains
  // "$", so choosing on the delimiter present is unambiguous either way.
  const parts = stored.includes("$") ? stored.split("$") : stored.split(".");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const params = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64, "base64");
    const actual = await scryptAsync(
      password.normalize("NFKC"),
      Buffer.from(saltB64, "base64"),
      expected.length,
      params,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
