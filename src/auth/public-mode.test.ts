import { afterEach, describe, expect, it } from "vitest";
import { publicPositionsVisible, publicReadOnly } from "./public-mode";

/**
 * These two flags decide whether the app is on the open internet, so the thing
 * worth testing is not that "true" works — it is that everything else does not.
 */

afterEach(() => {
  delete process.env.PUBLIC_READ_ONLY;
  delete process.env.PUBLIC_SHOW_POSITIONS;
});

describe("publicReadOnly", () => {
  it("is off when unset", () => {
    delete process.env.PUBLIC_READ_ONLY;
    expect(publicReadOnly()).toBe(false);
  });

  it("is on only for the exact opt-in", () => {
    process.env.PUBLIC_READ_ONLY = "true";
    expect(publicReadOnly()).toBe(true);
  });

  it("tolerates the casing and whitespace a dashboard paste introduces", () => {
    for (const raw of ["TRUE", " true ", "True"]) {
      process.env.PUBLIC_READ_ONLY = raw;
      expect(publicReadOnly()).toBe(true);
    }
  });

  it.each(["", "false", "1", "yes", "on", "no", "null", "undefined", "t"])(
    "stays off for %o",
    (raw) => {
      process.env.PUBLIC_READ_ONLY = raw;
      expect(publicReadOnly()).toBe(false);
    },
  );
});

describe("publicPositionsVisible", () => {
  it("is off when unset, even with read-only mode on", () => {
    process.env.PUBLIC_READ_ONLY = "true";
    delete process.env.PUBLIC_SHOW_POSITIONS;
    expect(publicPositionsVisible()).toBe(false);
  });

  it("is independent of read-only mode", () => {
    process.env.PUBLIC_SHOW_POSITIONS = "true";
    delete process.env.PUBLIC_READ_ONLY;
    expect(publicPositionsVisible()).toBe(true);
    expect(publicReadOnly()).toBe(false);
  });

  it.each(["", "false", "1", "yes"])("stays off for %o", (raw) => {
    process.env.PUBLIC_SHOW_POSITIONS = raw;
    expect(publicPositionsVisible()).toBe(false);
  });
});
