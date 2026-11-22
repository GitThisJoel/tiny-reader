import { describe, expect, it, vi } from "vitest";
import { loadFrontEnd } from "./frontends.ts";
import { createLoader } from "./loader.ts";
import { BUNDLED } from "./models.ts";

const BUNDLED_FILE = Uint8Array.of(0);
const GOOD = Uint8Array.of(1);
const BAD = Uint8Array.of(2);

/** A loader over a storage of `files`, whose engines only remember which file they were made from. */
function setup(files: Record<string, Uint8Array> = {}) {
  const log: string[] = [];
  const load = createLoader({
    bundled: async () => BUNDLED_FILE,
    stored: async (id) => {
      log.push(`look up ${id}`);
      return files[id] ?? null;
    },
    create: async (file, model) => {
      log.push(`for ${model.id}`);
      if (file === BAD) throw new Error("its inputs are (x), not (y)");
      const name = file === BUNDLED_FILE ? "bundled" : "downloaded";
      log.push(`create ${name}`);
      return { name, release: async () => void log.push(`release ${name}`) };
    },
    status: (state) => log.push(state),
  });
  return { load, log, files };
}

describe("createLoader", () => {
  it("loads the bundled model once, however often it is asked for", async () => {
    const { load, log } = setup();
    const first = await load(BUNDLED.id);
    expect(first).toEqual({ engine: expect.objectContaining({ name: "bundled" }), model: BUNDLED });
    expect((await load(BUNDLED.id)).engine).toBe(first.engine);
    expect(log).toEqual(["loading", "for tiny-voca", "create bundled", "ready"]);
  });

  it("loads a downloaded model from storage, releasing the one loaded before", async () => {
    const { load, log } = setup({ sobbie: GOOD });
    await load(BUNDLED.id);
    const loaded = await load("sobbie");
    expect(loaded).toMatchObject({ engine: { name: "downloaded" }, model: { id: "sobbie" } });
    expect(loaded.notice).toBeUndefined();
    // Read from storage once, not for every sentence.
    expect((await load("sobbie")).engine).toBe(loaded.engine);
    expect(log).toEqual([
      "loading",
      "for tiny-voca",
      "create bundled",
      "ready",
      "look up sobbie",
      "loading",
      "release bundled",
      "for sobbie",
      "create downloaded",
      "ready",
    ]);
  });

  it("falls back to the bundled model, with a notice, when the model is not in storage", async () => {
    const { load, log, files } = setup();
    const bundled = await load(BUNDLED.id);
    const loaded = await load("sobbie");
    expect(loaded.engine).toBe(bundled.engine); // kept: nothing is loaded again
    expect(loaded.model).toBe(BUNDLED);
    expect(loaded.notice).toBe(
      "The voice model SobbieTTS is not downloaded any more. Download it again in Tiny Reader's settings. This is read with the built-in tiny-voca voice.",
    );
    expect(log).not.toContain("release bundled");

    // Downloaded again while the engine is running: used from the next sentence on.
    files.sobbie = GOOD;
    expect(await load("sobbie")).toMatchObject({ engine: { name: "downloaded" }, model: { id: "sobbie" } });
  });

  it("falls back, with the reason, when the stored file is not a model the engine can use", async () => {
    const { load, log } = setup({ fiato: BAD });
    const loaded = await load("fiato");
    expect(loaded).toMatchObject({ engine: { name: "bundled" }, model: BUNDLED });
    expect(loaded.notice).toBe(
      "The voice model fiato could not be used: its inputs are (x), not (y). This is read with the built-in tiny-voca voice.",
    );
    // The broken file is not tried again for every sentence.
    const again = await load("fiato");
    expect(again.engine).toBe(loaded.engine);
    expect(again.notice).toBe(loaded.notice);
    expect(log.filter((entry) => entry === "look up fiato")).toHaveLength(1);
  });

  it("falls back, with the reason, when the model needs a text front end the engine does not have", async () => {
    const made: string[] = [];
    // An engine that has every front end but SobbieTTS's, refused by loadFrontEnd itself.
    const load = createLoader({
      bundled: async () => BUNDLED_FILE,
      stored: async () => GOOD,
      create: async (file, model) => {
        if (file !== BUNDLED_FILE) await loadFrontEnd(`${model.frontend}-de`, async () => new ArrayBuffer(0));
        made.push(model.id);
        return { release: async () => {} };
      },
      status: () => {},
    });
    const loaded = await load("sobbie");
    expect(loaded.model).toBe(BUNDLED);
    expect(loaded.notice).toBe(
      'The voice model SobbieTTS could not be used: it needs the text front end "dizione-de", which this version of Tiny Reader does not have. This is read with the built-in tiny-voca voice.',
    );
    expect(made).toEqual(["tiny-voca"]);
  });

  it("falls back when storage itself cannot be read, and tries storage again the next time", async () => {
    const stored = vi
      .fn<(id: string) => Promise<Uint8Array | null>>()
      .mockRejectedValueOnce(new Error("the database is gone"))
      .mockResolvedValue(Uint8Array.of(1));
    const load = createLoader({
      bundled: async () => BUNDLED_FILE,
      stored,
      create: async () => ({ release: async () => {} }),
      status: () => {},
    });
    expect((await load("sobbie")).notice).toMatch(/could not be used: the database is gone\./);
    const again = await load("sobbie");
    expect([again.model.id, again.notice]).toEqual(["sobbie", undefined]);
  });

  it("reads with the bundled model for an id that is not in the list", async () => {
    const { load } = setup();
    expect(await load("nope")).toMatchObject({ engine: { name: "bundled" }, model: BUNDLED });
  });

  it("tries again after the bundled model failed to load", async () => {
    let fail = true;
    const load = createLoader({
      bundled: async () => {
        if (fail) throw new Error("not yet");
        return BUNDLED_FILE;
      },
      stored: async () => null,
      create: async () => ({ release: async () => {} }),
      status: () => {},
    });
    await expect(load(BUNDLED.id)).rejects.toThrow("not yet");
    fail = false;
    expect((await load(BUNDLED.id)).model).toBe(BUNDLED);
  });
});
