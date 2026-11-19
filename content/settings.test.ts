import { beforeEach, describe, expect, it } from "vitest";
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
      voice: 1,
      speed: 1.5,
      pitchShift: 2 * SEMITONE,
      pitchRange: 1.4,
      prefetch: 4,
    };
    expect(parseSettings(settings)).toEqual(settings);
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

  it("never stores an invalid value", async () => {
    await saveSettings({ speed: 50 });
    expect((await loadSettings()).speed).toBe(2);
  });
});
