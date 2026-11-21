import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  documentFragment,
  isCommand,
  isCommandMessage,
  parseDocumentFragment,
  pdfName,
  sitePattern,
  webUrl,
} from "./commands.ts";

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

  it("falls back to the tab title the PDF viewer sets, for addresses without the ending", () => {
    expect(pdfName("https://arxiv.org/pdf/1706.03762", "1706.03762v7.pdf")).toBe("1706.03762v7.pdf");
    expect(pdfName("https://arxiv.org/pdf/1706.03762", "Attention Is All You Need - 1706.03762v7.pdf")).toBe(
      "1706.03762v7.pdf",
    );
    expect(pdfName("https://example.com/download?id=7", "  document.pdf ")).toBe("document.pdf");
    // The address wins when it has a name of its own.
    expect(pdfName("https://example.com/a/report.pdf", "Annual report - other.pdf")).toBe("report.pdf");
    for (const title of ["", "Attention Is All You Need", "How to read a .pdf file", "pdf"])
      expect(pdfName("https://arxiv.org/abs/1706.03762", title), title).toBeNull();
  });

  it("treats only http(s) addresses as downloadable", () => {
    expect(webUrl("https://example.com/a.pdf")).toBe("https://example.com/a.pdf");
    expect(webUrl("http://127.0.0.1:8080/a.pdf")).toBe("http://127.0.0.1:8080/a.pdf");
    for (const url of [
      "file:///home/me/a.pdf",
      "about:reader?url=x",
      "javascript:alert(1)",
      "moz-extension://x/a.pdf",
      "",
      null,
      undefined,
    ])
      expect(webUrl(url), String(url)).toBeNull();
  });

  it("asks for the PDF's whole site, without the port", () => {
    expect(sitePattern("https://example.com/papers/a.pdf?x=1")).toBe("https://example.com/*");
    expect(sitePattern("http://127.0.0.1:8080/a.pdf")).toBe("http://127.0.0.1/*");
  });

  it("carries a document request through the page's address", () => {
    const request = { name: "My report & more.pdf", url: "https://example.com/papers/My%20report.pdf?v=2#page=3" };
    expect(parseDocumentFragment(documentFragment(request))).toEqual(request);
    expect(parseDocumentFragment(documentFragment({ name: "local.pdf", url: null }))).toEqual({
      name: "local.pdf",
      url: null,
    });
    expect(documentFragment({ name: null, url: null })).toBe("");
    expect(parseDocumentFragment("")).toEqual({ name: null, url: null });
  });

  it("drops an address that is not http(s) when reading a request", () => {
    expect(parseDocumentFragment("#name=x.pdf&url=file%3A%2F%2F%2Fetc%2Fpasswd")).toEqual({ name: "x.pdf", url: null });
    expect(parseDocumentFragment("#url=javascript%3Aalert(1)")).toEqual({ name: null, url: null });
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
