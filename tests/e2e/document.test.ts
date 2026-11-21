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
    // The first page is drawn: there is ink on its canvas, and its first line of text lies on it.
    const drawn = await firefox.waitFor<{ ink: boolean; onPage: boolean }>(
      page,
      `const canvas = document.querySelector(".page canvas");
       if (!canvas.width) return null;
       const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
       let ink = false;
       for (let at = 0; at < pixels.length && !ink; at += 4) ink = pixels[at + 3] > 0 && pixels[at] < 128;
       if (!ink) return null;
       const sheet = canvas.getBoundingClientRect();
       const line = document.querySelector(".textLayer span").getBoundingClientRect();
       return { ink, onPage: line.top > sheet.top && line.bottom < sheet.bottom && line.left > sheet.left && line.right < sheet.right && line.width > 100 };`,
    );
    expect(drawn).toEqual({ ink: true, onPage: true });
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
    const lines: PdfLine[] = [["A page of a longer document.", 720]];
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

  it("stops the reading when another file is opened, and says so when a file is not a PDF", async () => {
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
