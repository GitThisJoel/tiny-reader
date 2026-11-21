// Draws the pictures of the toolbar popup in docs/screenshots from the built add-on, in headless
// Firefox, so they show the popup as the code makes it and nothing of the desktop around it.
//
//   pnpm build && pnpm screenshots
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ADDON_URL, Firefox } from "../tests/e2e/firefox.ts";
import { startSite } from "../tests/e2e/site.ts";

const OUT = join(import.meta.dirname, "../docs/screenshots");
const site = await startSite();
// A window large enough to hold the whole popup: a picture shows only what the window does.
process.env.MOZ_HEADLESS_WIDTH = "2000";
process.env.MOZ_HEADLESS_HEIGHT = "2400";
// Two device pixels per CSS pixel, so the pictures stay sharp when scaled.
const firefox = await Firefox.launch({ "layout.css.devPixelsPerPx": "2.0" });

/** The popup as it looks when opened on the tab `front`. */
async function popupOn(front: string): Promise<Buffer> {
  const popup = await firefox.open(`${ADDON_URL}/popup.html`);
  await firefox.evaluate(front, "return 1;"); // `front` is the active tab again
  // Loaded afresh behind it: the popup asks about the active tab as it opens.
  await firefox.evaluateBehind(popup, "window.stale = true; location.reload();");
  await firefox.waitFor(
    popup,
    "return !window.stale && document.body?.dataset.page && document.querySelector('#voice');",
  );
  // A thin frame, since the popup's own edge is drawn by Firefox and is not part of the page.
  await firefox.evaluate(popup, `document.body.style.border = "1px solid #b1b1b9";`);
  return firefox.screenshot(popup, "body");
}

try {
  // The add-on's own page counts as readable without the user having invoked the add-on there.
  const readable = await firefox.open(`${ADDON_URL}/document.html`);
  await writeFile(join(OUT, "popup.png"), await popupOn(readable));

  // A PDF in Firefox's viewer. The shortcut is the user asking to read it, which lets the add-on see the tab.
  const pdf = await firefox.open(`${site.url}papers/A%20short%20report.pdf`);
  await firefox.waitFor(pdf, `return document.querySelectorAll(".textLayer span").length > 0;`);
  await firefox.shortcut(pdf, "Alt+Shift+R");
  await writeFile(join(OUT, "popup-pdf.png"), await popupOn(pdf));
  console.log(`Wrote popup.png and popup-pdf.png to ${OUT}`);
} finally {
  await firefox.close();
  site.close();
}
