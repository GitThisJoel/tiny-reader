// The add-on's own document page: open a PDF, see its text as paragraphs, have it read with highlighting.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { buildPdf, temporaryFile } from "./pdf.ts";

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
const SENTENCE = `
  const [range] = CSS.highlights.get("tiny-reader-sentence") ?? [];
  return range ? range.toString() : null;`;
const content = () =>
  firefox.evaluate<{
    heading: string | null;
    paragraphs: string[];
    status: string;
    kind: string;
    start: boolean;
    title: string;
  }>(
    page,
    `return {
      heading: document.getElementById("name").textContent || null,
      paragraphs: [...document.querySelectorAll("#document p")].map((p) => p.textContent),
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
    expect(await content()).toMatchObject({ heading: null, paragraphs: [], start: false });
  });

  it("opens a PDF and rebuilds its paragraphs", async () => {
    await firefox.upload(page, "#file", report);
    await opened();
    const shown = await content();
    expect(shown.heading).toBe("A short report.pdf");
    expect(shown.paragraphs).toEqual([
      "A Short Report",
      "The quick brown fox jumps over the lazy dog, and then it continues along the river for a while. It was a sunny day.",
      "A second paragraph starts after a gap and runs on to the next page without stopping in the middle of a sentence.",
      "The end.",
    ]);
    expect(shown).toMatchObject({ kind: "info", start: true, title: "A short report · Tiny Reader" });
  }, 60_000);

  it("reads it from the start, highlighting sentence and word", async () => {
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
    expect(
      await firefox.evaluate(
        page,
        `return getComputedStyle(document.querySelector("#document p"), "::highlight(tiny-reader-sentence)").backgroundColor;`,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
  }, 60_000);

  it("takes Read from here from the context menu, like a web page", async () => {
    await firefox.contextMenu(page, "#document p:nth-of-type(3)", "Read from here with tiny-voca");
    await barWhen(`bar.status === "playing" && bar.text === "Sentence 1 of 2"`);
    expect(await firefox.evaluate(page, SENTENCE)).toBe(
      "A second paragraph starts after a gap and runs on to the next page without stopping in the middle of a sentence.",
    );
  }, 60_000);

  it("stops the reading when another file is opened, and says so when a file is not a PDF", async () => {
    await firefox.upload(page, "#file", await temporaryFile("notes.pdf", "this is not a pdf"));
    await opened();
    await noBar();
    const shown = await content();
    expect(shown).toMatchObject({ heading: null, paragraphs: [], start: false, kind: "error" });
    expect(shown.status).toMatch(/^This file could not be read as a PDF/);
  }, 60_000);

  it("says so when a PDF has no text", async () => {
    await firefox.upload(page, "#file", await temporaryFile("scan.pdf", buildPdf([[]])));
    await opened();
    expect(await content()).toMatchObject({
      paragraphs: [],
      start: false,
      kind: "error",
      status: expect.stringMatching(/no text to read/),
    });
  }, 60_000);
});
