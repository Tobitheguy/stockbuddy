/**
 * Session cookie: an expiry timestamp plus an HMAC over it.
 *
 * There is exactly one user, so there is nothing to look up — the cookie
 * carries its own expiry and the signature proves the server issued it. No
 * session table, no store to keep in sync, and revocation is available by
 * rotating SESSION_SECRET.
 *
 * Deliberately built on Web Crypto rather than node:crypto so the same code
 * verifies the cookie in `proxy.ts` regardless of which runtime that ends up
 * on. Password hashing lives in ./password and stays on Node.
 */

export const SESSION_COOKIE = "sd_session";

/** Long enough not to be a nuisance on a private tool checked daily. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Bumping this invalidates every issued cookie without touching the secret. */
const VERSION = "sd1";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return s;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Returned as an ArrayBuffer rather than the Uint8Array `encode` gives back:
 * a typed array's buffer may be a SharedArrayBuffer as far as the type system
 * knows, which Web Crypto does not accept.
 */
function payload(expiresAtMs: number): ArrayBuffer {
  const bytes = new TextEncoder().encode(`${VERSION}:${expiresAtMs}`);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Value to store in the cookie. */
export async function signSession(
  expiresAtMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), payload(expiresAtMs));
  return `${expiresAtMs}.${toBase64Url(sig)}`;
}

/**
 * True only for a well-formed, unexpired, correctly signed cookie.
 *
 * The expiry is checked *after* the signature: checking it first would let an
 * unsigned cookie decide how much work the server does, and there is no reason
 * to give an unauthenticated caller that.
 */
export async function verifySession(
  value: string | undefined | null,
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;

  const expiresAtMs = Number(value.slice(0, dot));
  if (!Number.isSafeInteger(expiresAtMs)) return false;

  const sig = fromBase64Url(value.slice(dot + 1));
  if (!sig) return false;

  let ok: boolean;
  try {
    // subtle.verify is constant-time; never compare signatures with ===.
    ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      sig.buffer.slice(
        sig.byteOffset,
        sig.byteOffset + sig.byteLength,
      ) as ArrayBuffer,
      payload(expiresAtMs),
    );
  } catch {
    return false;
  }

  return ok && expiresAtMs > Date.now();
}
