import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { parseRequest } from "@/engine/protocol.ts";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, SEMITONE, saveSettings } from "./settings.ts";

beforeEach(() => fakeBrowser.reset());

describe("parseSettings", () => {
  it("gives the defaults for missing or malformed data", () => {
    for (const value of [undefined, null, "x", 3, [], {}]) expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const settings = {
      model: "fiato",
      voice: 1,
      speed: 1.5,
      pitchShift: 2 * SEMITONE,
      pitchRange: 1.4,
      prefetch: 4,
    };
    expect(parseSettings(settings)).toEqual(settings);
  });

  it("falls back to the bundled model for one that is not in the list", () => {
    for (const model of ["gone", 3, null])
      expect(parseSettings({ model, voice: 1 })).toMatchObject({ model: "tiny-voca", voice: 1 });
  });

  it("clamps numbers and rejects everything else, field by field", () => {
    expect(
      parseSettings({
        voice: 7,
        speed: 99,
        pitchShift: -9,
        pitchRange: "1",
        prefetch: 2.6,
      }),
    ).toEqual({
      model: "tiny-voca",
      voice: 0,
      speed: 2,
      pitchShift: -0.5,
      pitchRange: 1,
      prefetch: 3,
    });
    expect(parseSettings({ speed: Number.NaN, prefetch: -3, voice: 0.5 })).toEqual({
      ...DEFAULT_SETTINGS,
      prefetch: 0,
    });
    // An emptied number field on the options page reads as NaN.
    expect(parseSettings({ prefetch: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });

  it("always yields options the engine accepts", () => {
    for (const stored of [{}, { speed: 1e9, pitchShift: 1e9, pitchRange: -1e9, voice: -1 }]) {
      const { prefetch: _, ...options } = parseSettings(stored);
      expect(parseRequest({ type: "synthesize", id: "1", text: "Hi.", options })).not.toBeNull();
    }
  });
});

describe("stored settings", () => {
  it("loads defaults from empty storage", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("saves a change on top of what is stored", async () => {
    await saveSettings({ speed: 1.5 });
    expect(await saveSettings({ voice: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      speed: 1.5,
      voice: 1,
    });
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      speed: 1.5,
      voice: 1,
    });
  });

  it("keeps both of two changes saved at once, as two quick changes in the control bar are", async () => {
    // The first write takes its time. Unordered, the second save would read the old settings meanwhile.
    const write = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    const spy = vi.spyOn(fakeBrowser.storage.local, "set").mockImplementationOnce(async (items) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return write(items);
    });
    await Promise.all([saveSettings({ speed: 1.5 }), saveSettings({ voice: 1 })]);
    expect(await loadSettings()).toMatchObject({ speed: 1.5, voice: 1 });
    spy.mockRestore();
  });

  it("goes on saving after a save that failed", async () => {
    const spy = vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValueOnce(new Error("storage is full"));
    await expect(saveSettings({ speed: 1.5 })).rejects.toThrow("storage is full");
    expect(await saveSettings({ voice: 1 })).toMatchObject({ speed: DEFAULT_SETTINGS.speed, voice: 1 });
    spy.mockRestore();
  });

  it("never stores an invalid value", async () => {
    await saveSettings({ speed: 50 });
    expect((await loadSettings()).speed).toBe(2);
  });
});
