// A PDF open in Firefox's own viewer: it cannot be read there, and the popup leads to the page where it can.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentFragment } from "../../content/commands.ts";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let viewer: string;
/** The add-on's document page, once the popup has opened it. */
let documentPage = "";
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
const paragraphs = (tab: string) =>
  firefox.evaluate<string[]>(tab, `return [...document.querySelectorAll("#document p")].map((p) => p.textContent);`);

/** Waits for Firefox's own permission prompt, answers it, and returns what it said. */
const answerPrompt = (answer: "allow" | "refuse") =>
  firefox.chrome<string>(
    `for (let tries = 0; tries < 80; tries++) {
       const prompt = PopupNotifications.panel.firstElementChild;
       if (PopupNotifications.panel.state === "open" && prompt) {
         const text = prompt.textContent;
         (arguments[0] === "allow" ? prompt.button : prompt.secondaryButton).click();
         return text;
       }
       await new Promise((resolve) => setTimeout(resolve, 100));
     }
     return "no permission prompt appeared";`,
    [answer],
  );

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
    for (let tries = 0; tries < 50 && !documentPage; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      documentPage = (await firefox.tabs()).find((handle) => !before.includes(handle)) ?? "";
    }
    if (!documentPage) throw new Error("the document page did not open");
  }, 60_000);

  it("the document page asks before downloading, and opens the PDF once Firefox's prompt is accepted", async () => {
    const asking = await firefox.waitFor<{ status: string; allow: string | null }>(
      documentPage,
      `const allow = document.getElementById("allow");
       return location.pathname === "/document.html" && allow
         ? { status: document.getElementById("status").textContent.trim(), allow: allow.textContent }
         : null;`,
    );
    expect(asking).toEqual({
      status:
        "To open “My report.pdf” here, Tiny Reader has to download it from 127.0.0.1, and Firefox asks for your permission first. Or choose the file with Open a PDF.",
      allow: "Allow and open",
    });
    expect(await paragraphs(documentPage)).toEqual([]);

    await firefox.click(documentPage, "#allow");
    expect(await answerPrompt("allow")).toMatch(/127\.0\.0\.1/);
    await firefox.waitFor(documentPage, `return document.querySelectorAll("#document p").length > 0;`);
    expect(await paragraphs(documentPage)).toEqual([
      "A sample document",
      "This file exists to be shown in the PDF viewer of the browser.",
    ]);
    expect(
      await firefox.evaluate(
        documentPage,
        `return [document.getElementById("name").textContent, !!document.getElementById("allow")];`,
      ),
    ).toEqual(["My report.pdf", false]);
  }, 60_000);

  it("opens another PDF from the same site at once, with no prompt", async () => {
    const again = await firefox.open(
      `${ADDON_URL}/document.html${documentFragment({ name: "Other.pdf", url: `${site.url}other/Other.pdf` })}`,
    );
    await firefox.waitFor(again, `return document.querySelectorAll("#document p").length > 0;`);
    expect(
      await firefox.evaluate(
        again,
        `return [document.getElementById("name").textContent, !!document.getElementById("allow")];`,
      ),
    ).toEqual(["Other.pdf", false]);
  }, 60_000);

  it("downloads nothing when the prompt is refused, and says how to go on", async () => {
    // The same server under another name is another site as far as permissions go.
    const elsewhere = site.url.replace("127.0.0.1", "localhost");
    const refused = await firefox.open(
      `${ADDON_URL}/document.html${documentFragment({ name: "Secret.pdf", url: `${elsewhere}Secret.pdf` })}`,
    );
    await firefox.waitFor(refused, `return !!document.getElementById("allow");`);
    await firefox.click(refused, "#allow");
    expect(await answerPrompt("refuse")).toMatch(/localhost/);
    expect(
      await firefox.waitFor<string>(
        refused,
        `return document.getElementById("allow") ? null : document.getElementById("status").textContent.trim();`,
      ),
    ).toBe("Without that permission, choose the file with Open a PDF, or drop it on this page.");
    expect(await paragraphs(refused)).toEqual([]);
  }, 60_000);

  it("says so when the site does not deliver the file", async () => {
    const missing = await firefox.open(
      `${ADDON_URL}/document.html${documentFragment({ name: "Gone.pdf", url: `${site.url}missing/Gone.pdf?status=404` })}`,
    );
    expect(
      await firefox.waitFor<string>(
        missing,
        `const status = document.getElementById("status"); return status.dataset.kind === "error" ? status.textContent.trim() : null;`,
      ),
    ).toBe("127.0.0.1 answered with error 404. Choose the file with Open a PDF instead.");
  }, 60_000);

  it("for a PDF on the computer, names the file to choose, since it cannot be downloaded", async () => {
    const local = await firefox.open(`${ADDON_URL}/document.html${documentFragment({ name: "Local.pdf", url: null })}`);
    expect(
      await firefox.evaluate(
        local,
        `return [document.getElementById("status").textContent.trim(), !!document.getElementById("allow")];`,
      ),
    ).toEqual([
      "Choose “Local.pdf” with Open a PDF, or drop it on this page. Firefox does not let an add-on open a file on your computer by itself.",
      false,
    ]);
  }, 60_000);
});

describe("a PDF whose address does not end in .pdf", () => {
  it("is recognised by its tab title, and opens the same way", async () => {
    const unnamed = await firefox.open(`${site.url}pdf/1706.03762`);
    await firefox.waitFor(unnamed, `return document.querySelectorAll(".textLayer span").length > 0;`);
    expect(await firefox.evaluate(unnamed, "return document.title;")).toBe("paper-v7.pdf");
    // The context menu click is what lets the add-on see the tab, as a click on the toolbar button would.
    await firefox.evaluate(unnamed, `getSelection().selectAllChildren(document.querySelector(".textLayer"));`);
    await firefox.contextMenu(unnamed, ".textLayer span", "Read with tiny-voca");
    await firefox.chrome(
      `for (let tries = 0; tries < 50; tries++) {
         const open = [...document.querySelectorAll("panel")].filter((panel) => panel.state === "open");
         if (open.length) { for (const panel of open) panel.hidePopup(); return; }
         await new Promise((resolve) => setTimeout(resolve, 100));
       }`,
    );

    const popup = await popupFor(unnamed);
    expect(await shown(popup)).toMatchObject({ page: "pdf", visible: { read: false, openPdf: true } });
    const before = await firefox.tabs();
    await firefox.evaluateBehind(popup, `document.getElementById("open-pdf").click();`);
    let opened = "";
    for (let tries = 0; tries < 50 && !opened; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      opened = (await firefox.tabs()).find((handle) => !before.includes(handle)) ?? "";
    }
    // Permission for this site was given in the tests above, so it opens with no prompt.
    await firefox.waitFor(opened, `return document.querySelectorAll("#document p").length > 0;`);
    expect(await firefox.evaluate(opened, `return document.getElementById("name").textContent;`)).toBe("paper-v7.pdf");
    expect(await paragraphs(opened)).toHaveLength(2);
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
