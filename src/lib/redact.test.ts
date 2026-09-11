import { describe, expect, it } from "vitest";
import { redactEmails } from "./redact";

describe("redactEmails", () => {
  it("removes the contact address SEC_USER_AGENT is required to carry", () => {
    // Shaped like a real EDGAR block message, which quotes the request back.
    const err =
      "403 Forbidden: Your Request Originates from an Undeclared Automated " +
      "Tool. Declared agent: SignalDesk/1.0 (tobias@example.com)";
    const out = redactEmails(err);
    expect(out).not.toContain("tobias@example.com");
    expect(out).toContain("[email removed]");
    // The rest of the message has to survive or the page stops being useful.
    expect(out).toContain("403 Forbidden");
    expect(out).toContain("SignalDesk/1.0");
  });

  it("removes every address, not just the first", () => {
    const out = redactEmails("from a@b.com cc c.d+tag@sub.example.co.uk");
    expect(out).not.toMatch(/@/);
  });

  it("leaves text without an address alone", () => {
    const err = "ETIMEDOUT connecting to feeds.example.com:443 after 10000ms";
    expect(redactEmails(err)).toBe(err);
  });

  it("does not mangle an @ that is not an address", () => {
    const err = "rate limit: 10 req/@second exceeded";
    expect(redactEmails(err)).toBe(err);
  });
});
