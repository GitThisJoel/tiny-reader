import { describe, expect, it } from "vitest";
import { finished, normalize, splitLong } from "./text.ts";

describe("normalize", () => {
  it("turns every whitespace character into one space and keeps the length", () => {
    const text = "a\tb\nc d\r\n e";
    expect(normalize(text)).toBe("a b c d   e");
    expect(normalize(text)).toHaveLength(text.length);
  });
});

describe("finished", () => {
  it.each([
    ["Hello", "Hello."],
    ["Hello  \n", "Hello."],
    ["Hello.", "Hello."],
    ["Really?", "Really?"],
    ["He said “stop.”", "He said “stop.”"],
    ["one, two,", "one, two,"],
    ["see you :)", "see you :)."],
    ["wait …", "wait …"],
    ["", ""],
    ["   ", "   "],
  ])("%j → %j", (input, expected) => {
    expect(finished(input)).toBe(expected);
  });
});

describe("splitLong", () => {
  const longerThan = (limit: number) => (piece: string) => piece.trim().length > limit;
  const rebuilt = (text: string, limit: number) => {
    const pieces = splitLong(text, longerThan(limit));
    for (const piece of pieces) expect(text.slice(piece.offset, piece.offset + piece.text.length)).toBe(piece.text);
    return pieces;
  };

  it("keeps a short text whole", () => {
    expect(splitLong("Short one.", longerThan(50))).toEqual([{ text: "Short one.", offset: 0 }]);
  });

  it("gives nothing for blank text", () => {
    expect(splitLong("   ", longerThan(5))).toEqual([]);
  });

  it("cuts after commas first, with offsets into the original", () => {
    const text = "first part, second part; third part: fourth";
    const pieces = rebuilt(text, 14);
    expect(pieces.map((piece) => piece.text)).toEqual(["first part, ", "second part; ", "third part: ", "fourth"]);
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
  });

  it("halves between words when there is no comma", () => {
    const text = "one two three four five six seven eight";
    const pieces = rebuilt(text, 12);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
    for (const piece of pieces) expect(piece.text.trim().length).toBeLessThanOrEqual(12);
  });

  it("drops a single word that cannot be cut", () => {
    expect(splitLong("Pneumonoultramicroscopic", longerThan(5))).toEqual([]);
    expect(splitLong("ok Pneumonoultramicroscopic", longerThan(5)).map((piece) => piece.text)).toEqual(["ok "]);
  });

  it("cuts a long clause whose only comma is at its end", () => {
    // The cut after that comma is the end of the piece: it must fall back to cutting between words.
    const text = "one two three four five six, ";
    const pieces = rebuilt(text, 12);
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
    for (const piece of pieces) expect(piece.text.trim().length).toBeLessThanOrEqual(12);
    expect(rebuilt(`${text}seven eight`, 12).length).toBeGreaterThan(3);
  });

  it("always terminates", () => {
    expect(splitLong("a ".repeat(500), () => true)).toEqual([]);
  });
});
