import { describe, expect, it } from "vitest";
import { pdfText, type TextItem } from "./pdf-text.ts";

const paragraphsOf = (pages: TextItem[][]) => {
  const { text } = pdfText(pages);
  return text ? text.split("\n") : [];
};

/** A line of text at height `y`, as one run that ends its line. */
const line = (str: string, y: number, height = 12): TextItem => ({ str, x: 72, y, height, hasEOL: true });

describe("paragraphsOf", () => {
  it("joins the lines of a paragraph and splits at a wide gap", () => {
    expect(
      paragraphsOf([
        [
          line("The first paragraph runs", 700),
          line("over two lines.", 686),
          line("The second starts after a gap.", 650),
        ],
      ]),
    ).toEqual(["The first paragraph runs over two lines.", "The second starts after a gap."]);
  });

  it("treats a change of font size as a heading", () => {
    expect(
      paragraphsOf([[line("A Short Report", 720, 24), line("Body text follows", 700), line("the heading.", 686)]]),
    ).toEqual(["A Short Report", "Body text follows the heading."]);
  });

  it("rejoins a word hyphenated at a line end", () => {
    expect(paragraphsOf([[line("and then it con-", 700), line("tinues along the river.", 686)]])).toEqual([
      "and then it continues along the river.",
    ]);
  });

  it("keeps a hyphen that is followed by a capital or a digit", () => {
    expect(
      paragraphsOf([[line("the years 1990-", 700), line("1995 and the Anglo-", 686), line("Saxon period", 672)]]),
    ).toEqual(["the years 1990- 1995 and the Anglo- Saxon period"]);
  });

  it("builds a line from several runs and collapses its spaces", () => {
    const runs: TextItem[] = [
      { str: "Hello", x: 72, y: 700, height: 12, hasEOL: false },
      { str: " ", x: 100, y: 700, height: 0, hasEOL: false },
      { str: "big ", x: 104, y: 700, height: 12, hasEOL: false },
      { str: " world.", x: 130, y: 700, height: 12, hasEOL: true },
    ];
    expect(paragraphsOf([runs])).toEqual(["Hello big world."]);
  });

  it("starts a new line at a new baseline even without an end-of-line mark", () => {
    const runs: TextItem[] = [
      { str: "First line", x: 72, y: 700, height: 12, hasEOL: false },
      { str: "second line.", x: 72, y: 686, height: 12, hasEOL: false },
    ];
    expect(paragraphsOf([runs])).toEqual(["First line second line."]);
  });

  it("keeps a superscript on its line", () => {
    const runs: TextItem[] = [
      { str: "E = mc", x: 72, y: 700, height: 12, hasEOL: false },
      { str: "2", x: 110, y: 704, height: 8, hasEOL: false },
      { str: " is famous.", x: 116, y: 700, height: 12, hasEOL: true },
    ];
    expect(paragraphsOf([runs])).toEqual(["E = mc2 is famous."]);
  });

  it("drops page numbers and carries a sentence across the page break", () => {
    expect(
      paragraphsOf([
        [line("A paragraph runs on to the", 100), line("next page without", 86), line("1", 40, 10)],
        [line("stopping in the middle.", 720), line("The end.", 680), line("Page 2 of 2", 40, 10)],
      ]),
    ).toEqual(["A paragraph runs on to the next page without stopping in the middle.", "The end."]);
  });

  it("starts a new paragraph on a new page when the sentence had ended", () => {
    expect(paragraphsOf([[line("It ended here.", 100)], [line("and this is not a continuation.", 720)]])).toEqual([
      "It ended here.",
      "and this is not a continuation.",
    ]);
  });

  it("gives nothing for a document without text", () => {
    expect(paragraphsOf([])).toEqual([]);
    expect(paragraphsOf([[], [{ str: "  ", x: 0, y: 0, height: 0, hasEOL: true }]])).toEqual([]);
  });
});

describe("pdfText", () => {
  it("maps every word back to its run, and joining spaces to none", () => {
    const pages: TextItem[][] = [
      [line("and then it con-", 700), line("tinues  on.", 686), line("1", 40, 10)],
      [
        { str: "It ", x: 72, y: 700, height: 12, hasEOL: false },
        { str: "ends.", x: 90, y: 700, height: 12, hasEOL: true },
      ],
    ];
    const { text, runs } = pdfText(pages);
    expect(text).toBe("and then it continues on.\nIt ends.");
    // Each run gives back exactly its stretch of the text, taken from the page's own string.
    for (const run of runs)
      expect(pages[run.page]?.[run.item]?.str.slice(run.start, run.start + run.length)).toBe(
        text.slice(run.textStart, run.textStart + run.length),
      );
    // "continues" is two runs, on two lines, without its hyphen. The page number has none.
    expect(runs.map((run) => text.slice(run.textStart, run.textStart + run.length))).toEqual([
      "and",
      "then",
      "it",
      "con",
      "tinues",
      "on.",
      "It",
      "ends.",
    ]);
    expect(runs.map((run) => [run.page, run.item])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });
});
