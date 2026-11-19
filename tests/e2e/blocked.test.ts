// Pages Firefox lets no add-on into, such as Reader View: nothing can be read there, and the user is told.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let reader: string;
let extension: string;
beforeAll(async () => {
  site = await startSite();
  firefox = await Firefox.launch();
  extension = await firefox.open(`${ADDON_URL}/options.html`);
  reader = await firefox.open(`about:reader?url=${encodeURIComponent(`${site.url}long/12`)}`);
  await firefox.waitFor(reader, `return document.readyState === "complete" && document.body.innerText.length > 200;`);
}, 90_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

/** What the toolbar button shows for the active tab, asked from one of the add-on's own pages. */
const button = () =>
  firefox.evaluateBehind<{ badge: string; title: string }>(
    extension,
    `const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
     return { badge: await browser.action.getBadgeText({ tabId: tab.id }), title: await browser.action.getTitle({ tabId: tab.id }) };`,
  );

describe("Reader View", () => {
  it("starts with a plain toolbar button", async () => {
    await firefox.evaluate(reader, "return 1;");
    expect(await button()).toEqual({ badge: "", title: "Tiny Reader" });
  });

  it("cannot be read from the context menu, and the toolbar button says why", async () => {
    await firefox.evaluate(
      reader,
      `const paragraph = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("Paragraph 2"));
       paragraph.id = "target";
       getSelection().selectAllChildren(paragraph);`,
    );
    await firefox.contextMenu(reader, "#target", "Read with tiny-voca");
    await firefox.waitFor(extension, "return 1;"); // let the background finish
    await firefox.evaluate(reader, "return 1;");
    let shown = await button();
    for (let tries = 0; tries < 30 && !shown.badge; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      shown = await button();
    }
    expect(shown.badge).toBe("!");
    expect(shown.title).toMatch(/^Tiny Reader cannot read here\. Firefox keeps add-ons out of Reader View/);
    expect(await firefox.evaluate(reader, `return !!document.querySelector("tiny-reader-bar");`)).toBe(false);
  }, 60_000);

  it("the popup stays open and explains, instead of closing as if it had worked", async () => {
    const popup = await firefox.open(`${ADDON_URL}/popup.html`);
    await firefox.waitFor(popup, `return document.querySelectorAll("#controls button").length === 4;`);
    await firefox.evaluate(reader, "return 1;"); // Reader View is the active tab again
    await firefox.evaluateBehind(popup, `document.getElementById("read").click();`);
    const hint = await firefox.waitFor<{ text: string; role: string }>(
      popup,
      `const hint = document.getElementById("read-hint");
       return hint.getAttribute("role") === "alert" ? { text: hint.textContent, role: hint.getAttribute("role") } : null;`,
    );
    expect(hint.text).toMatch(/Firefox keeps add-ons out of Reader View/);
  }, 60_000);
});
