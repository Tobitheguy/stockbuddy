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

/** Format: scrypt$N$r$p$<salt-b64>$<hash-b64> */
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
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/** Never throws on a malformed stored value — a bad hash means "no match". */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
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
