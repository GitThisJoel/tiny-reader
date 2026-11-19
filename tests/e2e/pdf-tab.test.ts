// A PDF open in Firefox's own viewer: it cannot be read there, and the popup leads to the page where it can.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let viewer: string;
beforeAll(async () => {
  site = await startSite();
  firefox = await Firefox.launch();
  viewer = await firefox.open(`${site.url}papers/My%20report.pdf`);
  await firefox.waitFor(viewer, `return document.querySelectorAll(".textLayer span").length > 0;`);
}, 90_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

/** Opens the popup page in a tab behind `front`, as if the toolbar button had been clicked there. */
async function popupFor(front: string) {
  const popup = await firefox.open(`${ADDON_URL}/popup.html`);
  await firefox.evaluate(front, "return 1;"); // `front` is the active tab again
  // Load it afresh now that the right tab is in front: the popup asks about the active tab as it opens.
  await firefox.evaluateBehind(popup, "window.stale = true; location.reload();");
  for (let tries = 0; tries < 100; tries++) {
    const page = await firefox
      .evaluateBehind<string | null>(popup, "return window.stale ? null : (document.body?.dataset.page ?? null);")
      .catch(() => null);
    if (page) return popup;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the popup did not find out about its tab");
}
const shown = (popup: string) =>
  firefox.evaluateBehind<{
    page: string;
    hint: string;
    role: string | null;
    visible: Record<string, boolean>;
    open: string;
  }>(
    popup,
    `const visible = (id) => !!document.getElementById(id) && getComputedStyle(document.getElementById(id)).display !== "none";
     return {
       page: document.body.dataset.page,
       hint: document.getElementById("read-hint").textContent.trim(),
       role: document.getElementById("read-hint").getAttribute("role"),
       visible: { read: visible("read"), controls: visible("controls"), openPdf: visible("open-pdf"), form: visible("form") },
       open: document.getElementById("open-pdf")?.textContent.trim() ?? null,
     };`,
  );

describe("a PDF in Firefox's viewer", () => {
  it("trying to read it from the context menu opens the popup by itself", async () => {
    await firefox.evaluate(viewer, `getSelection().selectAllChildren(document.querySelector(".textLayer"));`);
    await firefox.contextMenu(viewer, ".textLayer span", "Read with tiny-voca");
    const panel = await firefox.chrome<string | null>(
      `for (let tries = 0; tries < 50; tries++) {
         for (const panel of document.querySelectorAll("panel")) {
           const address = panel.querySelector("browser")?.currentURI?.spec ?? "";
           if (panel.state === "open" && address.includes("/popup.html")) return address;
         }
         await new Promise((resolve) => setTimeout(resolve, 100));
       }
       return null;`,
    );
    expect(panel).toBe(`${ADDON_URL}/popup.html`);
    await firefox.chrome(
      `for (const panel of document.querySelectorAll("panel")) if (panel.state === "open") panel.hidePopup();`,
    );
  }, 60_000);

  // After the test above: the menu click is what lets the add-on see this tab's address, as a click on the
  // toolbar button would.
  it("the popup says it is a PDF and offers to open it in Tiny Reader", async () => {
    const popup = await popupFor(viewer);
    expect(await shown(popup)).toEqual({
      page: "pdf",
      hint: "This is a PDF. Firefox does not let add-ons read inside its PDF viewer, so Tiny Reader reads PDFs on a page of its own.",
      role: "alert",
      visible: { read: false, controls: false, openPdf: true, form: true },
      open: "Open this PDF in Tiny Reader…",
    });

    const before = await firefox.tabs();
    await firefox.evaluateBehind(popup, `document.getElementById("open-pdf").click();`);
    let opened: string | undefined;
    for (let tries = 0; tries < 50 && !opened; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      opened = (await firefox.tabs()).find((handle) => !before.includes(handle));
    }
    if (!opened) throw new Error("the document page did not open");
    const status = await firefox.waitFor<string>(
      opened,
      `return location.pathname === "/document.html" ? document.getElementById("status").textContent.trim() : null;`,
    );
    expect(status).toBe(
      "Choose “My report.pdf” with Open a PDF, or drop it on this page. Firefox does not let an add-on open it by itself.",
    );
  }, 60_000);
});

describe("a page that can be read", () => {
  it("the popup shows its reading controls and no warning", async () => {
    const page = await firefox.open(site.url);
    // The add-on has no access to a tab until the user invokes it there.
    await firefox.evaluate(page, `getSelection().selectAllChildren(document.querySelector("#first"));`);
    await firefox.contextMenu(page, "#first", "Read with tiny-voca");
    await firefox.waitFor(page, `return !!document.querySelector("tiny-reader-bar");`);
    const popup = await popupFor(page);
    expect(await shown(popup)).toMatchObject({
      page: "readable",
      role: null,
      visible: { read: true, controls: true, openPdf: false, form: true },
    });
  }, 60_000);
});
