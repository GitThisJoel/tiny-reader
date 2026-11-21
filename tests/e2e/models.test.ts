// Extra voice models: download one from the settings page, read with it, lose it, delete it.
//
// The real list only has models on Hugging Face, each pinned to a SHA-256, so no test file can
// stand in for one of them. This test therefore makes a build of its own, the production build
// plus one list entry: a stand-in model served by the local test site (see engine/models.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Model } from "../../engine/models.ts";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { STAND_IN, startSite } from "./site.ts";

const ROOT = join(import.meta.dirname, "../..");
let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let options: string;
let page: string;
beforeAll(async () => {
  site = await startSite();
  const standIn: Model = {
    id: "stand-in",
    name: "Stand-in",
    language: "en",
    frontend: "dizione",
    voices: ["Left", "Right"],
    licence: "Apache-2.0",
    source: site.url,
    repo: "",
    revision: "",
    file: "",
    size: STAND_IN.length,
    sha256: createHash("sha256").update(STAND_IN).digest("hex"),
    url: `${site.url}stand-in.onnx`,
  };
  execFileSync(join(ROOT, "node_modules/.bin/wxt"), ["build"], {
    cwd: ROOT,
    env: { ...process.env, VITE_E2E_MODEL: JSON.stringify(standIn) },
    stdio: "ignore",
  });
  firefox = await Firefox.launch({}, "firefox-mv3-e2e");
  options = await firefox.open(`${ADDON_URL}/options.html`);
  page = await firefox.open(site.url);
  // A user has clicked or typed in the page before reaching for a shortcut.
  await firefox.click(page, "#title");
}, 120_000);
afterAll(async () => {
  await firefox?.close();
  site?.close();
});

/** The settings page's controls for models: what can be chosen, and each downloadable model's row. */
const FORM = `
  const form = document.getElementById("form");
  return {
    models: [...form.elements.model.options].map((option) => option.text),
    model: form.elements.model.value,
    voices: [...form.elements.voice.options].map((option) => option.text),
    rows: Object.fromEntries([...form.querySelectorAll(".model")].map((row) => [
      row.dataset.model,
      [row.querySelector("button").textContent, row.querySelector("[role=status]").textContent],
    ])),
  };`;
interface Form {
  models: string[];
  model: string;
  voices: string[];
  rows: Record<string, [button: string, status: string]>;
}
const form = () => firefox.evaluate<Form>(options, FORM);
const formWhen = (condition: string) =>
  firefox.waitFor<Form>(options, `const form = (() => { ${FORM} })(); return (${condition}) ? form : null;`);
const choose = (model: string) =>
  firefox.evaluate(
    options,
    `const field = document.getElementById("form").elements.model;
     field.value = arguments[0];
     field.dispatchEvent(new Event("change", { bubbles: true }));
     for (;;) {
       if ((await browser.storage.local.get("settings")).settings?.model === arguments[0]) return;
       await new Promise((resolve) => setTimeout(resolve, 50));
     }`,
    [model],
  );
/** The ids of the models in the add-on's storage, read the way the add-on reads them. */
const storedIds = () =>
  firefox.evaluate<string[]>(
    options,
    `return new Promise((resolve, reject) => {
       const opening = indexedDB.open("models", 1);
       opening.onupgradeneeded = () => opening.result.createObjectStore("files");
       opening.onerror = () => reject(opening.error);
       opening.onsuccess = () => {
         const keys = opening.result.transaction("files").objectStore("files").getAllKeys();
         keys.onsuccess = () => resolve(keys.result);
         opening.result.close();
       };
     });`,
  );
/** Presses a model's button. For a download, Firefox asks for access to the model's site first. */
const press = (model: string) => firefox.click(options, `[data-model="${model}"] button`);
const origins = () => firefox.evaluate<string[]>(options, `return (await browser.permissions.getAll()).origins;`);
const settings = () =>
  firefox.evaluate<{ model: string; voice: number }>(
    options,
    `return (await browser.storage.local.get("settings")).settings;`,
  );

const BAR = `
  const root = document.querySelector("tiny-reader-bar")?.openOrClosedShadowRoot;
  if (!root) return null;
  const notice = root.querySelector("[role=alert]");
  return {
    status: root.querySelector("[role=toolbar]").dataset.status,
    voices: [...root.querySelector('select[aria-label="Voice"]').options].map((option) => option.text),
    voice: root.querySelector('select[aria-label="Voice"]').value,
    notice: notice.hidden ? null : notice.textContent,
  };`;
interface Bar {
  status: string;
  voices: string[];
  voice: string;
  notice: string | null;
}
/** Reads a paragraph of the page with the shortcut and returns the bar once `condition` holds. */
async function read(condition = `bar.status === "playing"`): Promise<Bar> {
  await firefox.evaluate(page, `getSelection().selectAllChildren(document.querySelector("#second"));`);
  await firefox.shortcut(page, "Alt+Shift+R");
  return firefox.waitFor<Bar>(
    page,
    `const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
    30_000,
    true,
  );
}
async function stop() {
  await firefox.shortcut(page, "Alt+Shift+X");
  await firefox.waitFor(page, `return !document.querySelector("tiny-reader-bar");`, 10_000);
}

/** Asks the engine for one sentence, as a reader does, and describes what comes back. */
const synthesize = (model: string) =>
  firefox.evaluate<{ samples: number; low: number; high: number; words: number; notice: string | null }>(
    options,
    `const port = browser.runtime.connect({ name: "engine" });
     const reply = await new Promise((resolve) => {
       port.onMessage.addListener((message) => message.type !== "status" && resolve(message));
       port.postMessage({
         type: "synthesize", id: "1", text: "Hello there.",
         options: { model: arguments[0], voice: 1, speed: 1, pitchShift: 0, pitchRange: 1 },
       });
     });
     port.disconnect();
     if (reply.type !== "result") throw new Error(reply.message);
     let [low, high] = [Infinity, -Infinity];
     for (const sample of reply.pcm) [low, high] = [Math.min(low, sample), Math.max(high, sample)];
     return { samples: reply.pcm.length, low, high, words: reply.words.length, notice: reply.notice ?? null };`,
    [model],
  );

describe("extra voice models", () => {
  it("lists what can be downloaded and offers only the bundled model until something is", async () => {
    expect(await formWhen(`form.models.length`)).toEqual({
      models: ["tiny-voca"],
      model: "tiny-voca",
      voices: ["F2", "M2"],
      rows: { sobbie: ["Download", ""], fiato: ["Download", ""], "stand-in": ["Download", ""] },
    });
  }, 30_000);

  it("asks for access to the model's site, and downloads nothing when that is refused", async () => {
    await press("stand-in");
    expect(await firefox.answerPrompt("refuse")).toMatch(/127\.0\.0\.1/);
    const refused = await formWhen(`form.rows["stand-in"][1]`);
    expect(refused.rows["stand-in"]).toEqual([
      "Download",
      "Nothing was downloaded: Firefox was not allowed to reach 127.0.0.1.",
    ]);
    expect(site.modelRequests).toHaveLength(0);
  }, 30_000);

  it("stores nothing when the download is not the file the list pins", async () => {
    site.tamper = true;
    await press("stand-in");
    await firefox.answerPrompt("allow");
    const refused = await formWhen(`form.rows["stand-in"][1].startsWith("The download")`);
    site.tamper = false;
    expect(refused.rows["stand-in"]).toEqual(["Download", "The download is not the file Tiny Reader expects."]);
    expect(refused.models).toEqual(["tiny-voca"]);
    expect(await storedIds()).toEqual([]);
    expect(site.modelRequests).toHaveLength(1);
  }, 30_000);

  it("downloads a model once access is given, sending nothing that tells who asks, and offers it", async () => {
    await press("stand-in");
    await firefox.answerPrompt("allow");
    const downloaded = await formWhen(`form.rows["stand-in"][0] === "Delete"`);
    expect(downloaded.rows["stand-in"]).toEqual(["Delete", "Downloaded"]);
    expect(downloaded.models).toEqual(["tiny-voca", "Stand-in"]);
    expect(downloaded.model).toBe("tiny-voca"); // offered, not chosen for the user
    expect(await storedIds()).toEqual(["stand-in"]);
    // One request per download. No cookies, and no Origin header, which would carry the
    // add-on's address: an id of this installation.
    expect(site.modelRequests).toHaveLength(2);
    for (const headers of site.modelRequests)
      expect([headers.cookie, headers.authorization, headers.origin, headers.referer]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    // The access was for the download only.
    await firefox.waitFor(options, `return (await browser.permissions.getAll()).origins.length === 0;`);
    expect(await origins()).toEqual([]);
  }, 30_000);

  it("reads with the chosen model, and the bar offers that model's voices", async () => {
    await choose("stand-in");
    expect((await form()).voices).toEqual(["Left", "Right"]);
    const bar = await read();
    expect(bar).toEqual({ status: "playing", voices: ["Left", "Right"], voice: "0", notice: null });
    await stop();
    // What the engine made is the stand-in's sound, a constant level, not speech from the bundled model.
    const spoken = await synthesize("stand-in");
    expect(spoken.notice).toBeNull();
    expect(spoken.samples).toBeGreaterThan(0);
    expect(spoken.words).toBe(2);
    expect([spoken.low, spoken.high].map((level) => level.toFixed(3))).toEqual(["0.100", "0.100"]);
    expect((await synthesize("tiny-voca")).high).toBeGreaterThan(0.3);
  }, 60_000);

  it("reads with the bundled model and says why when the chosen model's file is gone", async () => {
    // The last test left the bundled model loaded. Storage is cleared behind the add-on's back.
    await firefox.evaluate(
      options,
      `await new Promise((resolve, reject) => {
         const deleting = indexedDB.deleteDatabase("models");
         deleting.onsuccess = resolve;
         deleting.onerror = deleting.onblocked = reject;
       });`,
    );
    const bar = await read(`bar.status === "playing" && bar.notice`);
    expect(bar.notice).toBe(
      "The voice model Stand-in is not downloaded any more. Download it again in Tiny Reader's settings. This is read with the built-in tiny-voca voice.",
    );
    await stop();
    const spoken = await synthesize("stand-in");
    expect(spoken.notice).toBe(bar.notice);
    expect(spoken.high).toBeGreaterThan(0.3); // speech
  }, 60_000);

  it("deleting the chosen model goes back to the bundled one", async () => {
    await firefox.reload(options);
    // Its file is gone, so it is not offered, though it is still the stored choice.
    expect(await formWhen(`form.models.length`)).toMatchObject({
      models: ["tiny-voca"],
      rows: { "stand-in": ["Download", ""] },
    });
    expect((await settings()).model).toBe("stand-in");
    await press("stand-in");
    await firefox.answerPrompt("allow");
    await formWhen(`form.rows["stand-in"][0] === "Delete"`);
    await choose("stand-in");

    await press("stand-in"); // now Delete, which asks nothing
    expect(await formWhen(`form.rows["stand-in"][0] === "Download"`)).toMatchObject({
      models: ["tiny-voca"],
      model: "tiny-voca",
      voices: ["F2", "M2"],
    });
    await firefox.waitFor(
      options,
      `return (await browser.storage.local.get("settings")).settings.model === "tiny-voca";`,
    );
    expect(await read()).toMatchObject({ voices: ["F2", "M2"], notice: null });
    await stop();
  }, 60_000);
});
