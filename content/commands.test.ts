import { describe, expect, it } from "vitest";
import { COMMANDS, isCommand, isCommandMessage, pdfName } from "./commands.ts";

describe("commands", () => {
  it("knows its own names and nothing else", () => {
    for (const name of COMMANDS) expect(isCommand(name)).toBe(true);
    for (const value of ["read-from-here", "explode", "", 3, null, undefined]) expect(isCommand(value)).toBe(false);
  });

  it("finds the file name in a PDF address", () => {
    expect(pdfName("file:///home/me/Downloads/Improve%20style%20matching.pdf")).toBe("Improve style matching.pdf");
    expect(pdfName("https://example.com/papers/report.PDF?download=1#page=2")).toBe("report.PDF");
    for (const url of ["https://example.com/", "https://example.com/pdf", "about:reader?url=x.pdf", "not a url", ""])
      expect(pdfName(url), url).toBeNull();
  });

  it("accepts only well-formed command messages", () => {
    expect(isCommandMessage({ type: "command", name: "read" })).toBe(true);
    for (const value of [
      null,
      "read",
      {},
      { type: "command" },
      { type: "command", name: "nope" },
      { type: "x", name: "read" },
    ])
      expect(isCommandMessage(value)).toBe(false);
  });
});
