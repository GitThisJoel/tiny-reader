// Moving the control bar: by dragging, from the keyboard, kept inside the window, and remembered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let tab: string;
beforeAll(async () => {
  site = await startSite();
  firefox = await Firefox.launch();
  tab = await firefox.open(site.strictUrl);
}, 60_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Place {
  bar: Box;
  grip: Box;
  status: Box;
  window: { width: number; height: number };
  state: string;
}
const PLACE = `
  const host = document.querySelector("tiny-reader-bar");
  const root = host?.openOrClosedShadowRoot;
  if (!root) return null;
  const box = (element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
  };
  return {
    bar: box(host),
    grip: box(root.querySelector(".grip")),
    status: box(root.querySelector("[role=status]")),
    window: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    state: root.querySelector("[role=toolbar]").dataset.status,
  };`;
const place = () => firefox.evaluate<Place>(tab, PLACE, [], true);
const centre = (box: Box): [number, number] => [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
const read = async () => {
  await firefox.evaluate(tab, `getSelection().selectAllChildren(document.querySelector("#first"));`);
  await firefox.contextMenu(tab, "#first", "Read with tiny-voca");
  await firefox.waitFor(tab, `const place = (() => { ${PLACE} })(); return place?.state === "playing";`, 30_000, true);
};
const stop = () =>
  firefox.evaluate(
    tab,
    `document.querySelector("tiny-reader-bar").openOrClosedShadowRoot.querySelector('button[aria-label="Stop reading"]').click();`,
    [],
    true,
  );

describe("moving the control bar", () => {
  it("starts at the bottom centre", async () => {
    await read();
    const { bar, window } = await place();
    expect(Math.abs((bar.left + bar.right) / 2 - window.width / 2)).toBeLessThan(2);
    expect(window.height - bar.bottom).toBeCloseTo(16, 0);
  }, 60_000);

  it("follows a drag on the grip, and keeps reading", async () => {
    const before = await place();
    const [x, y] = centre(before.grip);
    await firefox.drag(tab, [x, y], [x - 150, y - 200]);
    const after = await place();
    expect(after.bar.left - before.bar.left).toBeCloseTo(-150, 0);
    expect(after.bar.top - before.bar.top).toBeCloseTo(-200, 0);
    expect(after.bar.right - after.bar.left).toBeCloseTo(before.bar.right - before.bar.left, 0);
    expect(after.state).toBe("playing");
  }, 60_000);

  it("can be dragged by the status text too, but a drag on a button does not move it", async () => {
    const before = await place();
    const [x, y] = centre(before.status);
    await firefox.drag(tab, [x, y], [x + 60, y + 40]);
    const moved = await place();
    expect(moved.bar.left - before.bar.left).toBeCloseTo(60, 0);
    expect(moved.bar.top - before.bar.top).toBeCloseTo(40, 0);

    // The pause button sits just right of the grip and the previous button.
    const button: [number, number] = [moved.grip.right + 50, (moved.grip.top + moved.grip.bottom) / 2];
    await firefox.drag(tab, button, [button[0] + 80, button[1] + 80]);
    expect((await place()).bar).toEqual(moved.bar);
  }, 60_000);

  it("cannot be dragged out of the window", async () => {
    const before = await place();
    await firefox.drag(tab, centre(before.grip), [5, 5]);
    const corner = await place();
    expect(corner.bar.left).toBe(0);
    expect(corner.bar.top).toBe(0);
    await firefox.drag(tab, centre(corner.grip), [corner.window.width - 5, corner.window.height - 5]);
    const far = await place();
    expect(far.bar.right).toBeLessThanOrEqual(far.window.width);
    expect(far.bar.bottom).toBeLessThanOrEqual(far.window.height);
    expect(far.bar.left).toBeGreaterThan(corner.window.width / 2);
  }, 60_000);

  it("moves with the arrow keys while the grip has focus", async () => {
    await firefox.drag(tab, centre((await place()).grip), [300, 300]);
    const before = await place();
    const scrolled = await firefox.evaluate(tab, "return [scrollX, scrollY];");
    await firefox.evaluate(
      tab,
      `document.querySelector("tiny-reader-bar").openOrClosedShadowRoot.querySelector(".grip").focus();`,
      [],
      true,
    );
    await firefox.press(tab, "ArrowLeft", "ArrowLeft", "ArrowUp");
    const after = await place();
    expect(after.bar.left - before.bar.left).toBeCloseTo(-32, 0);
    expect(after.bar.top - before.bar.top).toBeCloseTo(-16, 0);
    // The page did not scroll under the arrow keys.
    expect(await firefox.evaluate(tab, "return [scrollX, scrollY];")).toEqual(scrolled);
  }, 60_000);

  it("opens the next reading where it was left", async () => {
    const before = await place();
    await stop();
    await read();
    const again = await place();
    expect(again.bar.left).toBeCloseTo(before.bar.left, 0);
    expect(again.bar.top).toBeCloseTo(before.bar.top, 0);
    await stop();
  }, 60_000);
});
