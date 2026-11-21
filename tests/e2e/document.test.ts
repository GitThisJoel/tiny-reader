// The add-on's own document page: open a PDF, see its pages, have it read with the highlight on the page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { buildPdf, type PdfLine, temporaryFile } from "./pdf.ts";

let firefox: Firefox;
let page: string;
let report: string;
beforeAll(async () => {
  firefox = await Firefox.launch();
  page = await firefox.open(`${ADDON_URL}/document.html`);
  // Two pages: a heading, a paragraph with a word hyphenated across lines, a paragraph that
  // runs on over the page break, and page numbers.
  report = await temporaryFile(
    "A short report.pdf",
    buildPdf([
      [
        ["A Short Report", 720, 24],
        ["The quick brown fox jumps over the lazy dog, and then it con-", 680],
        ["tinues along the river for a while. It was a sunny day.", 666],
        ["A second paragraph starts after a gap and runs on to the", 620],
        ["next page without", 606],
        ["1", 40, 10],
      ],
      [
        ["stopping in the middle of a sentence.", 720],
        ["The end.", 680],
        ["2", 40, 10],
      ],
    ]),
  );
}, 60_000);
afterAll(() => firefox?.close());

const BAR = `
  const root = document.querySelector("tiny-reader-bar")?.openOrClosedShadowRoot;
  if (!root) return null;
  return { status: root.querySelector("[role=toolbar]").dataset.status, text: root.querySelector("[role=status]").textContent };`;
const barWhen = (condition: string) =>
  firefox.waitFor<{ status: string; text: string }>(
    page,
    `const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
    30_000,
    true,
  );
const noBar = () => firefox.waitFor(page, `return !document.querySelector("tiny-reader-bar");`, 10_000);
const barButton = (label: string) =>
  firefox.evaluate(
    page,
    `document.querySelector("tiny-reader-bar").openOrClosedShadowRoot.querySelector("button[aria-label='${label}']").click();`,
    [],
    true,
  );
/** The text under the sentence highlight. The text layer has a piece per line, with nothing between them. */
const SENTENCE = `
  const [range] = CSS.highlights.get("tiny-reader-sentence") ?? [];
  return range ? range.toString() : null;`;
const sentenceIs = (text: string) =>
  firefox.waitFor(
    page,
    `return (() => { ${SENTENCE} })() === arguments[0];`.replace("arguments[0]", JSON.stringify(text)),
  );
/** Whether each page has been drawn: a page that is not near the window holds no picture. */
const DRAWN = `[...document.querySelectorAll(".page canvas")].map((canvas) => canvas.width > 0)`;
/**
 * Where the ink is on the first page's canvas and where its first line of text lies, both in
 * window coordinates. Null until the page is drawn.
 */
const INK_AND_TEXT = `
  const canvas = document.querySelector(".page canvas");
  if (!canvas.width) return null;
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let [left, top, right, bottom] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const at = (y * canvas.width + x) * 4;
      if (pixels[at + 3] === 0 || pixels[at] > 127) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  if (right < 0) return null;
  const sheet = canvas.getBoundingClientRect();
  const perPixel = sheet.width / canvas.width;
  const text = document.querySelector(".textLayer span").getBoundingClientRect();
  return {
    ink: { x: sheet.left + ((left + right) / 2) * perPixel, y: sheet.top + ((top + bottom) / 2) * perPixel, width: (right - left) * perPixel, height: (bottom - top) * perPixel },
    text: { x: text.left + text.width / 2, y: text.top + text.height / 2, width: text.width, height: text.height },
  };`;
type Box = { x: number; y: number; width: number; height: number };
const content = () =>
  firefox.evaluate<{
    heading: string | null;
    pages: string[];
    lines: string[];
    status: string;
    kind: string;
    start: boolean;
    title: string;
  }>(
    page,
    `return {
      heading: document.getElementById("name").textContent || null,
      pages: [...document.querySelectorAll("#document .page")].map((page) => page.ariaLabel),
      lines: [...document.querySelectorAll("#document .textLayer span")].map((span) => span.textContent),
      status: document.getElementById("status").textContent.trim(),
      kind: document.getElementById("status").dataset.kind ?? "info",
      start: !document.getElementById("start").disabled,
      title: document.title,
    };`,
  );
const opened = () =>
  firefox.waitFor(
    page,
    `return !/^(Opening|Reading page)/.test(document.getElementById("status").textContent.trim()) && document.getElementById("status").dataset.kind;`,
  );

describe("document page", () => {
  it("starts empty, with reading disabled", async () => {
    expect(await content()).toMatchObject({ heading: null, pages: [], start: false });
  });

  it("opens a PDF and shows its pages, with their text laid over them", async () => {
    await firefox.upload(page, "#file", report);
    await opened();
    const shown = await content();
    expect(shown).toMatchObject({
      heading: "A short report.pdf",
      pages: ["Page 1", "Page 2"],
      kind: "info",
      start: true,
      title: "A short report · Tiny Reader",
    });
    expect(shown.lines).toEqual([
      "A Short Report",
      "The quick brown fox jumps over the lazy dog, and then it con-",
      "tinues along the river for a while. It was a sunny day.",
      "A second paragraph starts after a gap and runs on to the",
      "next page without",
      "1",
      "stopping in the middle of a sentence.",
      "The end.",
      "2",
    ]);
  }, 60_000);

  it("draws the first page, with its text lying where the ink is", async () => {
    // Only the heading reaches as far up as it does; the other lines stretch the ink box down and right.
    const { ink, text } = await firefox.waitFor<{ ink: Box; text: Box }>(page, INK_AND_TEXT);
    expect(Math.abs(ink.y - ink.height / 2 - (text.y - text.height / 2))).toBeLessThan(12);
    expect(Math.abs(ink.x - ink.width / 2 - (text.x - text.width / 2))).toBeLessThan(6);
  }, 60_000);

  it("reads it from the start, highlighting sentence and word on the page", async () => {
    await firefox.click(page, "#start");
    const bar = await barWhen(`bar.status === "playing"`);
    // The document's title line, then two, one and one sentences. The file name is not read.
    expect(bar.text).toBe("Sentence 1 of 5");
    expect(await firefox.evaluate(page, SENTENCE)).toBe("A Short Report");
    const word = await firefox.waitFor<string>(
      page,
      `const [range] = CSS.highlights.get("tiny-reader-word") ?? []; return range ? range.toString() : null;`,
    );
    expect(["A", "Short", "Report"]).toContain(word);
    // See-through colour over text that is itself invisible: the page shows through the highlight.
    expect(
      await firefox.evaluate(
        page,
        `const style = getComputedStyle(document.querySelector(".textLayer span"), "::highlight(tiny-reader-sentence)");
         return [style.backgroundColor, style.color];`,
      ),
    ).toEqual(["rgba(255, 208, 0, 0.4)", "rgba(0, 0, 0, 0)"]);
  }, 60_000);

  it("follows a sentence over a line end, and reads the hyphenated word whole", async () => {
    await barButton("Next sentence");
    await sentenceIs(
      "The quick brown fox jumps over the lazy dog, and then it con-tinues along the river for a while.",
    );
  }, 60_000);

  it("leaves the page number out of a sentence that runs over the page break", async () => {
    await barButton("Next sentence");
    await barButton("Next sentence");
    // The highlight is one stretch of the page, so it spans the number; the number is not coloured.
    await sentenceIs(
      "A second paragraph starts after a gap and runs on to thenext page without1stopping in the middle of a sentence.",
    );
    expect(
      await firefox.evaluate(
        page,
        `return [...document.querySelectorAll(".textLayer span")].filter((span) => getComputedStyle(span, "::highlight(tiny-reader-sentence)").backgroundColor === "rgba(0, 0, 0, 0)").map((span) => span.textContent);`,
      ),
    ).toEqual(["1", "2"]);
  }, 60_000);

  it("scrolls to the sentence being read when it is out of view, and draws that page", async () => {
    expect(await firefox.evaluate(page, `return [scrollY, ${DRAWN}[1]];`)).toEqual([0, false]);
    await barButton("Next sentence");
    await sentenceIs("The end.");
    const shown = await firefox.waitFor<{ inView: boolean; scrolled: boolean }>(
      page,
      `if (!${DRAWN}[1]) return null;
       const [range] = CSS.highlights.get("tiny-reader-sentence");
       const { top, bottom } = range.getBoundingClientRect();
       return { inView: top > 0 && bottom < innerHeight, scrolled: scrollY > 0 };`,
    );
    expect(shown).toEqual({ inView: true, scrolled: true });
  }, 60_000);

  it("takes Read from here from the context menu, starting at that paragraph", async () => {
    // The paragraph's second line is clicked; reading starts at its first.
    await firefox.contextMenu(page, ".textLayer span:nth-of-type(5)", "Read from here with tiny-voca");
    await barWhen(`bar.status === "playing" && bar.text === "Sentence 1 of 2"`);
    await sentenceIs(
      "A second paragraph starts after a gap and runs on to thenext page without1stopping in the middle of a sentence.",
    );
  }, 60_000);

  it("reads a selection made on the page, and only that", async () => {
    await firefox.evaluate(
      page,
      `const [, second, third] = document.querySelectorAll(".textLayer span");
       getSelection().setBaseAndExtent(second.firstChild, 4, third.firstChild, 6);`,
    );
    await firefox.shortcut(page, "Alt+Shift+R");
    await barWhen(`bar.status === "playing" && bar.text === "Sentence 1 of 1"`);
    await sentenceIs("quick brown fox jumps over the lazy dog, and then it con-tinues");
  }, 60_000);

  it("draws only the pages near the window, and lets go of those left behind", async () => {
    const lines: PdfLine[] = [
      ["A page of a longer document.", 720],
      ["   ", 700],
    ];
    await firefox.upload(page, "#file", await temporaryFile("long.pdf", buildPdf(Array(8).fill(lines))));
    await opened();
    await noBar();
    await firefox.waitFor(page, `return ${DRAWN}[0];`);
    expect(await firefox.evaluate(page, `return ${DRAWN}.indexOf(false);`)).toBe(1);
    await firefox.evaluate(page, `scrollTo(0, document.documentElement.scrollHeight);`);
    await firefox.waitFor(page, `const drawn = ${DRAWN}; return drawn[7] && !drawn[0];`);
    expect((await firefox.evaluate<boolean[]>(page, `return ${DRAWN};`)).slice(0, 4)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // A page that was let go is drawn again when it comes back.
    await firefox.evaluate(page, `scrollTo(0, 0);`);
    await firefox.waitFor(page, INK_AND_TEXT);
    // Blank text between words is no page number: nothing here is kept out of the highlight.
    expect(await firefox.evaluate(page, `return document.querySelectorAll("[data-unread]").length;`)).toBe(0);
  }, 60_000);

  it("stops following once the reader has scrolled elsewhere", async () => {
    await firefox.evaluate(page, `scrollTo(0, 0);`);
    await firefox.click(page, "#start");
    await barWhen(`bar.status === "playing"`);
    // The second page's sentence is out of view, and reading follows it there.
    await barButton("Next sentence");
    await firefox.waitFor(page, `return scrollY > 500;`);
    // Scrolled away to the end, the reader is left there when the next sentence comes.
    const end = await firefox.evaluate<number>(
      page,
      `scrollTo(0, document.documentElement.scrollHeight); return scrollY;`,
    );
    await barButton("Next sentence");
    await barWhen(`bar.text === "Sentence 3 of 8"`);
    expect(await firefox.evaluate(page, `return scrollY;`)).toBe(end);
  }, 60_000);

  it("follows a new reading after one was stopped out of view", async () => {
    // The reading above is on page 3 and the window at the end of the document.
    await barButton("Stop reading");
    await noBar();
    await firefox.click(page, "#start");
    await barWhen(`bar.status === "playing" && bar.text === "Sentence 1 of 8"`);
    await firefox.waitFor(page, `return scrollY < 200;`);
  }, 60_000);

  it("turns the text with a page that is stored turned", async () => {
    const turned = buildPdf([[["A line on a page turned a quarter.", 720, 24]]], [{ rotate: 90 }]);
    await firefox.upload(page, "#file", await temporaryFile("turned.pdf", turned));
    await opened();
    await noBar();
    const { ink, text } = await firefox.waitFor<{ ink: Box; text: Box }>(page, INK_AND_TEXT);
    // The line runs down the page, and the text lies on the ink.
    expect(ink.height).toBeGreaterThan(ink.width * 5);
    expect(text.height).toBeGreaterThan(text.width * 5);
    expect([Math.abs(ink.x - text.x), Math.abs(ink.y - text.y)].every((off) => off < 12)).toBe(true);
    expect(Math.abs(ink.height - text.height)).toBeLessThan(ink.height * 0.1);
  }, 60_000);

  it("fits the widest page to the window when pages differ in size", async () => {
    const lines: PdfLine[] = [["A page.", 720]];
    await firefox.upload(
      page,
      "#file",
      await temporaryFile("mixed.pdf", buildPdf([lines, lines], [{}, { width: 1836 }])),
    );
    await opened();
    const widths = await firefox.evaluate<{ pages: number[]; room: number; overflow: boolean }>(
      page,
      `return {
        pages: [...document.querySelectorAll(".page")].map((page) => page.getBoundingClientRect().width),
        room: document.getElementById("document").clientWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };`,
    );
    expect(widths.overflow).toBe(false);
    expect(widths.pages[1]).toBeLessThanOrEqual(widths.room + 0.5);
    expect(widths.pages[1]).toBeCloseTo((widths.pages[0] ?? 0) * 3, 0);
  }, 60_000);

  it("gives way to a file opened while it is still loading", async () => {
    const lines: PdfLine[] = Array.from({ length: 30 }, (_, index) => ["A line of a long book.", 740 - index * 20]);
    await firefox.upload(page, "#file", await temporaryFile("book.pdf", buildPdf(Array(300).fill(lines))));
    await firefox.upload(page, "#file", report);
    await firefox.waitFor(page, `return document.getElementById("name").textContent === "A short report.pdf";`);
    // The book is gone for good: no page of it turns up later.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await content()).toMatchObject({ heading: "A short report.pdf", pages: ["Page 1", "Page 2"], start: true });
  }, 60_000);

  it("stops the reading when another file is opened, and says so when a file is not a PDF", async () => {
    await firefox.click(page, "#start");
    await barWhen(`bar.status === "playing"`);
    await firefox.upload(page, "#file", await temporaryFile("notes.pdf", "this is not a pdf"));
    await opened();
    await noBar();
    const shown = await content();
    expect(shown).toMatchObject({ heading: null, pages: [], start: false, kind: "error" });
    expect(shown.status).toMatch(/^This file could not be read as a PDF/);
  }, 60_000);

  it("shows a PDF that has no text, and says it cannot be read", async () => {
    await firefox.upload(page, "#file", await temporaryFile("scan.pdf", buildPdf([[]])));
    await opened();
    expect(await content()).toMatchObject({
      pages: ["Page 1"],
      lines: [],
      start: false,
      kind: "error",
      status: expect.stringMatching(/no text to read/),
    });
  }, 60_000);
});
