import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session";
import { hashPassword, verifyPassword } from "./password";

const SECRET = "0".repeat(64);

describe("session cookie", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  it("accepts a cookie it just issued", async () => {
    expect(await verifySession(await signSession())).toBe(true);
  });

  it("rejects an expired cookie even though the signature is valid", async () => {
    const expired = await signSession(Date.now() - 1000);
    expect(await verifySession(expired)).toBe(false);
  });

  it("rejects a cookie whose expiry was extended after signing", async () => {
    // The obvious forgery: keep the signature, move the deadline.
    const cookie = await signSession(Date.now() - 1000);
    const tampered = `${Date.now() + 86_400_000}.${cookie.split(".")[1]}`;
    expect(await verifySession(tampered)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", async () => {
    const cookie = await signSession();
    process.env.SESSION_SECRET = "1".repeat(64);
    expect(await verifySession(cookie)).toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of [
      undefined,
      null,
      "",
      ".",
      "abc",
      "123",
      "123.",
      ".sig",
      "notanumber.c2ln",
      `${Date.now() + 1000}.!!!not-base64!!!`,
      "9007199254740993.aaaa", // beyond safe integer range
    ]) {
      expect(await verifySession(bad)).toBe(false);
    }
  });

  it("refuses to sign when the secret is missing or too short", async () => {
    process.env.SESSION_SECRET = "";
    await expect(signSession()).rejects.toThrow(/SESSION_SECRET/);
    process.env.SESSION_SECRET = "short";
    await expect(signSession()).rejects.toThrow(/32 characters/);
  });
});

describe("password hashing", () => {
  // scrypt at OWASP parameters is intentionally slow; a handful of hashes is
  // enough to prove the contract.
  it("verifies the right password and rejects near misses", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  }, 30_000);

  it("produces a different hash each time, so the salt is real", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  }, 30_000);

  it("treats a malformed stored hash as no match rather than crashing", async () => {
    for (const bad of ["", "nonsense", "scrypt$x$8$1$aa$bb", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  }, 30_000);
});
