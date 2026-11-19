// The toolbar popup, opened as a page. Its buttons act on the active tab, so the test page stays in front.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let tab: string;
beforeAll(async () => {
  site = await startSite();
  firefox = await Firefox.launch();
  tab = await firefox.open(site.url);
  // Clicking the toolbar button gives the add-on the tab (activeTab). The test cannot click it, so
  // it earns the same grant the other way a user can: through the context menu.
  await select("#first");
  await firefox.contextMenu(tab, "#first", "Read with tiny-voca");
  await barWhen(`bar.status === "playing"`);
  await popupClick('#controls button[aria-label="Stop reading"]');
  await noBar();
}, 90_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

const BAR = `
  const root = document.querySelector("tiny-reader-bar")?.openOrClosedShadowRoot;
  if (!root) return null;
  return { status: root.querySelector("[role=toolbar]").dataset.status, text: root.querySelector("[role=status]").textContent };`;
const barWhen = (condition: string) =>
  firefox.waitFor<{ status: string; text: string }>(
    tab,
    `const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
    30_000,
    true,
  );
const noBar = () => firefox.waitFor(tab, `return !document.querySelector("tiny-reader-bar");`, 10_000);
const select = (selector: string) =>
  firefox.evaluate(tab, "getSelection().selectAllChildren(document.querySelector(arguments[0]));", [selector]);
const SENTENCE = `
  const [range] = CSS.highlights.get("tiny-reader-sentence") ?? [];
  return range ? range.toString().replace(/\\s+/g, " ") : null;`;

/** Opens the popup in a tab behind the test page and clicks one of its buttons. */
async function popupClick(selector: string) {
  const popup = await firefox.open(`${ADDON_URL}/popup.html`);
  await firefox.waitFor(popup, `return document.querySelectorAll("#controls button").length === 4;`);
  await firefox.evaluate(tab, "return 1;"); // the test page is the active tab again
  await firefox.evaluateBehind(popup, "document.querySelector(arguments[0]).click();", [selector]);
  return popup;
}

describe("toolbar popup", () => {
  it("has labelled controls and the settings form", async () => {
    const popup = await firefox.open(`${ADDON_URL}/popup.html`);
    await firefox.waitFor(popup, `return document.getElementById("form").elements.length > 4;`);
    expect(
      await firefox.evaluate(
        popup,
        `return {
          read: document.getElementById("read").textContent.trim(),
          controls: [...document.querySelectorAll("#controls button")].map((button) => button.getAttribute("aria-label")),
          labelled: [...document.querySelectorAll("select, input")].every((control) => control.labels.length === 1),
          width: document.body.getBoundingClientRect().width,
        };`,
      ),
    ).toEqual({
      read: "Read aloud",
      controls: ["Previous sentence", "Pause or resume", "Next sentence", "Stop reading"],
      labelled: true,
      width: 308,
    });
  }, 60_000);

  it("saves a setting changed in it, and the next reading uses it", async () => {
    const popup = await firefox.open(`${ADDON_URL}/popup.html`);
    await firefox.waitFor(popup, `return document.getElementById("form").elements.length > 4;`);
    await firefox.evaluate(
      popup,
      `const voice = document.getElementById("form").elements.voice;
       voice.value = "1";
       voice.dispatchEvent(new Event("change", { bubbles: true }));`,
    );
    await firefox.waitFor(popup, `return document.getElementById("saved").textContent.startsWith("Saved");`);
  }, 60_000);

  it("Read aloud reads the selection of the active tab", async () => {
    await select("#second");
    await popupClick("#read");
    expect((await barWhen(`bar.status === "playing"`)).text).toBe("Sentence 1 of 3");
    expect(
      await firefox.evaluate(
        tab,
        `return document.querySelector("tiny-reader-bar").openOrClosedShadowRoot.querySelector('select[aria-label="Voice"]').value;`,
        [],
        true,
      ),
    ).toBe("1");
  }, 60_000);

  it("its controls pause, skip and stop that reading", async () => {
    await popupClick('#controls button[aria-label="Pause or resume"]');
    await barWhen(`bar.status === "paused"`);
    await popupClick('#controls button[aria-label="Pause or resume"]');
    await barWhen(`bar.status === "playing"`);
    await popupClick('#controls button[aria-label="Next sentence"]');
    await barWhen(`bar.text === "Sentence 2 of 3"`);
    await popupClick('#controls button[aria-label="Stop reading"]');
    await noBar();
  }, 60_000);

  it("Read aloud with nothing selected reads the page's article from the top", async () => {
    await firefox.evaluate(tab, "getSelection().removeAllRanges();");
    await popupClick("#read");
    // The article: its heading, three sentences in each of two paragraphs, and one line it cannot read.
    expect((await barWhen(`bar.status === "playing"`)).text).toBe("Sentence 1 of 8");
    expect(await firefox.evaluate(tab, SENTENCE)).toBe("A short story");
    await popupClick('#controls button[aria-label="Stop reading"]');
    await noBar();
  }, 60_000);
});
