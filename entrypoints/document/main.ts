// The add-on's own page for documents Firefox will not let it read in place, PDFs above all.
// It shows the document's pages as they are and reads them with the highlight on the page.
import { browser } from "wxt/browser";
import { parseDocumentFragment, sitePattern } from "@/content/commands.ts";
import { createController, type ReaderCommand } from "@/content/controller.ts";
import { mapWithin } from "@/content/text-map.ts";
import { type ShownPdf, showPdf } from "./pdf.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const article = byId("document");
const status = byId("status");
const name = byId("name");
const startButton = byId<HTMLButtonElement>("start");
const fileInput = byId<HTMLInputElement>("file");

/** The PDF on show, once all of it has been read in. */
let shown: ShownPdf | null = null;
/** Counts the files opened, so one that is overtaken while loading can step aside. */
let opened = 0;

/** Whether the sentence starts in view: its first line clear of the header and of the control bar's usual place. */
function startsInView(range: Range): boolean {
  const { top, bottom } = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return top >= byId("header").offsetHeight && bottom <= innerHeight - 80;
}
let sentence: Range | null = null;
/** Keeps the sentence being read in view, unless the reader has scrolled away from the last one. */
function follow(range: Range | null) {
  const last = sentence?.getBoundingClientRect();
  const following = !last || (last.bottom > 0 && last.top < innerHeight);
  sentence = range;
  // A jump, not a glide: nothing moves between two sentences.
  if (range && following && !startsInView(range))
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

// The same commands a web page gets: toolbar popup, shortcuts and the context menu work here too.
// What is read is the PDF's text as rebuilt from its pages, not the text layer's scattered pieces.
const controller = createController({
  textOf: (range) => mapWithin(shown?.text ?? "", shown?.runs ?? [], range),
  onSentence: follow,
});
browser.runtime.onMessage.addListener((message: ReaderCommand) => controller.handle(message));

function say(message: string, kind: "info" | "error" = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

/** Why a PDF could not be fetched from its site. The message is for the user. */
class DownloadError extends Error {}

/** Shows the PDF called `fileName`, whose bytes `bytes` delivers, replacing whatever was open. */
async function load(fileName: string, bytes: () => Promise<ArrayBuffer>) {
  const mine = ++opened;
  controller.handle({ type: "stop" });
  document.getElementById("allow")?.remove();
  shown?.close();
  shown = null;
  sentence = null;
  const pages = document.createElement("div");
  article.replaceChildren(pages);
  name.textContent = "";
  document.title = "Tiny Reader";
  startButton.disabled = true;
  say(`Opening ${fileName}…`);
  try {
    const pdf = await showPdf(await bytes(), pages, (page, total) => {
      if (mine === opened) say(`Reading page ${page} of ${total}…`);
    });
    if (mine !== opened) {
      pdf.close();
      return;
    }
    shown = pdf;
    name.textContent = fileName;
    document.title = `${fileName.replace(/\.pdf$/i, "")} · Tiny Reader`;
    if (!pdf.text) {
      say("This PDF has no text to read. It may be a scan: pages stored as pictures.", "error");
      return;
    }
    startButton.disabled = false;
    say("Press Read from the start, or right-click a line and choose Read from here with tiny-voca.");
  } catch (error) {
    if (mine !== opened) return;
    if (error instanceof DownloadError) say(`${error.message} Choose the file with Open a PDF instead.`, "error");
    else say(`This file could not be read as a PDF. ${error instanceof Error ? error.message : ""}`.trim(), "error");
  }
}

const open = (file: File) => load(file.name, () => file.arrayBuffer());

/**
 * A PDF on the web: download it and open it, once the user has let the add-on reach that site.
 * This is the add-on's only network request, and it only fetches: nothing is sent but the
 * request itself, with the cookies the browser already has for the site, as when viewing the PDF.
 */
async function openFromWeb(url: string, fileName: string) {
  const origins = [sitePattern(url)];
  const host = new URL(url).hostname;
  const download = () =>
    load(fileName, async () => {
      const response = await fetch(url, { credentials: "include" }).catch(() => null);
      if (!response) throw new DownloadError(`Tiny Reader could not reach ${host}.`);
      if (!response.ok) throw new DownloadError(`${host} answered with error ${response.status}.`);
      return response.arrayBuffer();
    });
  if (await browser.permissions.contains({ origins })) return download();

  say(
    `To open “${fileName}” here, Tiny Reader has to download it from ${host}, and Firefox asks for your permission first. Or choose the file with Open a PDF.`,
  );
  const allow = document.createElement("button");
  allow.type = "button";
  allow.id = "allow";
  allow.textContent = "Allow and open";
  // Firefox shows its permission prompt only in answer to a click on this page.
  allow.addEventListener("click", async () => {
    const granted = await browser.permissions.request({ origins });
    allow.remove();
    if (granted) await download();
    else say("Without that permission, choose the file with Open a PDF, or drop it on this page.");
  });
  status.after(allow);
}

// Opened from a PDF tab. A PDF on the web can be downloaded; a local file cannot be taken from
// the tab, but the page can say which one to pick.
const request = parseDocumentFragment(location.hash);
if (request.url) void openFromWeb(request.url, request.name ?? "this PDF");
else if (request.name)
  say(
    `Choose “${request.name}” with Open a PDF, or drop it on this page. Firefox does not let an add-on open a file on your computer by itself.`,
  );

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
