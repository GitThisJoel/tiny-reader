import { describe, expect, it } from "vitest";
import { segment } from "./segment.ts";

const texts = (text: string, max?: number) => segment(text, max).map((sentence) => sentence.text);

describe("segment", () => {
  it("splits into sentences with offsets into the source", () => {
    const text = "  First one.  Second one!\nThird?  ";
    const sentences = segment(text);
    expect(sentences.map((sentence) => sentence.text)).toEqual(["First one.", "Second one!", "Third?"]);
    for (const sentence of sentences) expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
  });

  it("does not break after titles, initials and common abbreviations", () => {
    expect(texts("Mr. Smith met Dr. Jones. They talked.")).toEqual(["Mr. Smith met Dr. Jones.", "They talked."]);
    expect(texts("J. R. R. Tolkien wrote it. Really.")).toEqual(["J. R. R. Tolkien wrote it.", "Really."]);
    expect(texts("Use a tool, e.g. Vitest. It works.")).toEqual(["Use a tool, e.g. Vitest.", "It works."]);
  });

  it("keeps a trailing abbreviation as its own sentence", () => {
    expect(texts("He spoke to the Dr. ")).toEqual(["He spoke to the Dr."]);
  });

  it("treats line breaks as sentence ends, so headings stand alone", () => {
    expect(texts("A Heading\nThe body starts here. And goes on.")).toEqual([
      "A Heading",
      "The body starts here.",
      "And goes on.",
    ]);
  });

  it("drops pieces with nothing to say", () => {
    expect(texts("Hello.\n---\n ... \nWorld.")).toEqual(["Hello.", "World."]);
    expect(segment("")).toEqual([]);
    expect(segment("  \n ")).toEqual([]);
  });

  it("cuts a very long sentence at commas, keeping offsets", () => {
    const text = `${"one two three four five, ".repeat(30)}and done.`;
    const sentences = segment(text, 100);
    expect(sentences.length).toBeGreaterThan(5);
    for (const sentence of sentences) {
      expect(sentence.text.length).toBeLessThanOrEqual(100);
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
    expect(sentences.map((sentence) => sentence.text).join(" ")).toBe(text);
  });

  it("never overlaps and stays in order", () => {
    const text = "Dr. A. B. Cee said: “Go.” Then (after 3.5 s) she left… Did she? Yes!\n\nNew paragraph, no stop";
    let previous = 0;
    for (const sentence of segment(text)) {
      expect(sentence.start).toBeGreaterThanOrEqual(previous);
      expect(sentence.end).toBeGreaterThan(sentence.start);
      previous = sentence.end;
    }
    expect(texts(text).at(-1)).toBe("New paragraph, no stop");
  });
});
