// Edges: other languages, nothing to read, very long pages and very long sentences.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let tab: string;
beforeAll(async () => {
  site = await startSite();
  firefox = await Firefox.launch();
  tab = await firefox.open(site.url);
}, 60_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

const BAR = `
  const root = document.querySelector("tiny-reader-bar")?.openOrClosedShadowRoot;
  if (!root) return null;
  const notice = root.querySelector("[role=alert]");
  return {
    status: root.querySelector("[role=toolbar]").dataset.status,
    text: root.querySelector("[role=status]").textContent,
    notice: notice.hidden ? null : notice.textContent,
  };`;
interface Bar {
  status: string;
  text: string;
  notice: string | null;
}
const barWhen = (page: string, condition: string, timeout = 30_000) =>
  firefox.waitFor<Bar>(
    page,
    `const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
    timeout,
    true,
  );
const press = (page: string, label: string) =>
  firefox.evaluate(
    page,
    `document.querySelector("tiny-reader-bar").openOrClosedShadowRoot
      .querySelector('button[aria-label="' + arguments[0] + '"]').click();`,
    [label],
    true,
  );
const select = (selector: string) =>
  firefox.evaluate(tab, "getSelection().selectAllChildren(document.querySelector(arguments[0]));", [selector]);
const READ = "Read with tiny-voca";
const FROM_HERE = "Read from here with tiny-voca";

describe("text that is not English", () => {
  it("warns, naming the language, and still reads", async () => {
    await select("#french");
    await firefox.contextMenu(tab, "#french", READ);
    const bar = await barWhen(tab, "bar.notice");
    expect(bar.notice).toBe("This looks like French. tiny-voca only reads English, so it will sound wrong.");
    expect((await barWhen(tab, `bar.status === "playing"`)).text).toBe("Sentence 1 of 3");
    await press(tab, "Stop reading");
  }, 60_000);

  it("does not warn for English", async () => {
    await select("#first");
    await firefox.contextMenu(tab, "#first", READ);
    await barWhen(tab, `bar.status === "playing"`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await barWhen(tab, "true")).notice).toBeNull();
    await press(tab, "Stop reading");
  }, 60_000);
});

describe("nothing to read", () => {
  it("says so in the bar instead of doing nothing", async () => {
    await firefox.contextMenu(tab, "#empty", FROM_HERE);
    const bar = await barWhen(tab, `bar.status === "error"`);
    expect(bar.text).toBe("There is no text to read here.");
    await press(tab, "Stop reading");
    expect(await firefox.evaluate(tab, `return !!document.querySelector("tiny-reader-bar");`)).toBe(false);
  }, 60_000);
});

describe("a very long sentence", () => {
  it("is cut into pieces that start playing promptly", async () => {
    await select("#runon");
    const started = Date.now();
    await firefox.contextMenu(tab, "#runon", READ);
    const bar = await barWhen(tab, `bar.status === "playing"`);
    expect(Date.now() - started).toBeLessThan(10_000);
    // About 2,900 characters with no punctuation: more than ten pieces of at most 300.
    const total = Number(/of (\d+)/.exec(bar.text)?.[1]);
    expect(total).toBeGreaterThanOrEqual(10);
    expect(total).toBeLessThan(40);
    const piece = await firefox.evaluate<string>(
      tab,
      `const [range] = CSS.highlights.get("tiny-reader-sentence"); return range.toString();`,
    );
    expect(piece.length).toBeLessThanOrEqual(300);
    expect(piece.startsWith("the river kept on running")).toBe(true);
    await press(tab, "Stop reading");
  }, 60_000);
});

describe("a very long page", () => {
  it("starts reading 6,000 sentences without a long wait and stays responsive", async () => {
    const page = await firefox.open(`${site.url}long/2000`);
    const started = Date.now();
    await firefox.contextMenu(page, "#p0", FROM_HERE);
    const bar = await barWhen(page, `bar.status === "playing"`);
    // Includes opening the menu, injecting the script and a cold engine start.
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(bar.text).toBe("Sentence 1 of 6000");

    const skipped = Date.now();
    await press(page, "Next sentence");
    await press(page, "Next sentence");
    await barWhen(page, `bar.status === "playing" && bar.text === "Sentence 3 of 6000"`);
    expect(Date.now() - skipped).toBeLessThan(5_000);
    expect(
      await firefox.evaluate(
        page,
        `const [range] = CSS.highlights.get("tiny-reader-sentence");
         return [range.startContainer.parentElement.id, range.toString()];`,
      ),
    ).toEqual(["p0", "Then it ends."]);
    await press(page, "Stop reading");
  }, 60_000);
});
