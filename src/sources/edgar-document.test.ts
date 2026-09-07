import { describe, expect, it } from "vitest";
import { pickPrimaryDocument } from "./edgar-document";

/**
 * The file lists here are copied verbatim from live EDGAR index.json responses.
 * The Sysco case is the one that exposed the bug: its complete-submission .txt
 * is 974 KB and opens on a credit-agreement table of contents, because a
 * 938 KB exhibit is concatenated ahead of the actual announcement. Reading the
 * wrong file is worse than reading none — the model scores confidently from
 * boilerplate.
 */
describe("pickPrimaryDocument", () => {
  it("picks the announcement, not the larger exhibit", () => {
    const sysco = [
      { name: "0000950142-26-002499-index-headers.html", size: "0" },
      { name: "0000950142-26-002499-index.html", size: "0" },
      { name: "0000950142-26-002499.txt", size: "997000" },
      { name: "eh260826450_425.htm", size: "34663" },
      { name: "eh260826450_ex1001.htm", size: "938573" },
    ];
    expect(pickPrimaryDocument(sysco)).toBe("eh260826450_425.htm");
  });

  it("ignores both index files", () => {
    expect(
      pickPrimaryDocument([
        { name: "0001234567-26-000001-index.htm", size: "0" },
        { name: "form8k.htm", size: "12000" },
      ]),
    ).toBe("form8k.htm");
  });

  it("skips exhibits regardless of naming style", () => {
    for (const exhibit of ["a_ex99.htm", "b_ex-101.htm", "c_ex_991.htm"]) {
      expect(
        pickPrimaryDocument([
          { name: exhibit, size: "5000" },
          { name: "primary.htm", size: "9000" },
        ]),
      ).toBe("primary.htm");
    }
  });

  it("returns null when a filing has no HTML document", () => {
    expect(
      pickPrimaryDocument([
        { name: "0001234567-26-000001.txt", size: "5000" },
        { name: "chart.jpg", size: "2000" },
      ]),
    ).toBeNull();
  });

  it("tolerates missing name and size fields", () => {
    expect(pickPrimaryDocument([{}, { name: "doc.htm" }])).toBe("doc.htm");
    expect(pickPrimaryDocument([])).toBeNull();
  });
});
