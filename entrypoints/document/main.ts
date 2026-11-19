// The add-on's own page for documents Firefox will not let it read in place, PDFs above all.
// It shows the document's text as plain paragraphs and reads them like any web page.
import { browser } from "wxt/browser";
import { createController, type ReaderCommand } from "@/content/controller.ts";
import { HIGHLIGHT_CSS } from "@/content/highlight.ts";
import { readPdf } from "./pdf.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const article = byId("document");
const status = byId("status");
const name = byId("name");
const startButton = byId<HTMLButtonElement>("start");
const fileInput = byId<HTMLInputElement>("file");

// The same commands a web page gets: toolbar popup, shortcuts and the context menu work here too.
const controller = createController();
browser.runtime.onMessage.addListener((message: ReaderCommand) => controller.handle(message));
// The highlight colours, which the background injects into web pages. A constructed sheet is not inline style.
const highlights = new CSSStyleSheet();
highlights.replaceSync(HIGHLIGHT_CSS);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlights];

function say(message: string, kind: "info" | "error" = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

async function open(file: File) {
  controller.handle({ type: "stop" });
  article.replaceChildren();
  name.textContent = "";
  document.title = "Tiny Reader";
  startButton.disabled = true;
  say(`Opening ${file.name}…`);
  try {
    const paragraphs = await readPdf(await file.arrayBuffer(), (page, pages) =>
      say(`Reading page ${page} of ${pages}…`),
    );
    if (!paragraphs.length) {
      say("This PDF has no text to read. It may be a scan: pages stored as pictures.", "error");
      return;
    }
    name.textContent = file.name;
    article.append(
      ...paragraphs.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );
    document.title = `${file.name.replace(/\.pdf$/i, "")} · Tiny Reader`;
    startButton.disabled = false;
    say("Press Read from the start, or right-click a paragraph and choose Read from here with tiny-voca.");
  } catch (error) {
    say(`This file could not be read as a PDF. ${error instanceof Error ? error.message : ""}`.trim(), "error");
  }
}

byId("open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files ?? [];
  if (file) void open(file);
  fileInput.value = ""; // choosing the same file again must work
});
startButton.addEventListener("click", () => {
  const range = document.createRange();
  range.selectNodeContents(article);
  void controller.start(range);
});

// Drop a file anywhere on the page.
addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.dataset.dropping = "";
});
addEventListener("dragleave", () => delete document.body.dataset.dropping);
addEventListener("drop", (event) => {
  event.preventDefault();
  delete document.body.dataset.dropping;
  const [file] = event.dataTransfer?.files ?? [];
  if (file) void open(file);
});
