import { browser } from "wxt/browser";
import { BUNDLED, modelById } from "@/engine/models.ts";
import { DEFAULT_OPTIONS, LIMITS, type SynthOptions } from "@/engine/protocol.ts";

export interface Settings extends SynthOptions {
  /** Sentences synthesized ahead of the one playing. */
  prefetch: number;
}

export const PREFETCH_LIMITS = [0, 5] as const;
export const DEFAULT_SETTINGS: Settings = { ...DEFAULT_OPTIONS, prefetch: 2 };
/** `pitchShift` is added to log F0; this much is one semitone. */
export const SEMITONE = Math.log(2) / 12;

const KEY = "settings";

const clamp = (value: unknown, [low, high]: readonly [number, number], fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

/** Stored data is not trusted: anything missing or out of range falls back or is clamped. */
export function parseSettings(value: unknown): Settings {
  const stored = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const voice = stored.voice;
  // A model that has left the list. Whether a listed one is still in storage is the engine's concern.
  const model = modelById(stored.model) ?? BUNDLED;
  return {
    model: model.id,
    voice:
      typeof voice === "number" && Number.isInteger(voice) && voice >= 0 && voice < model.voices.length
        ? voice
        : DEFAULT_SETTINGS.voice,
    speed: clamp(stored.speed, LIMITS.speed, DEFAULT_SETTINGS.speed),
    pitchShift: clamp(stored.pitchShift, LIMITS.pitchShift, DEFAULT_SETTINGS.pitchShift),
    pitchRange: clamp(stored.pitchRange, LIMITS.pitchRange, DEFAULT_SETTINGS.pitchRange),
    prefetch: Math.round(clamp(stored.prefetch, PREFETCH_LIMITS, DEFAULT_SETTINGS.prefetch)),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return parseSettings(stored[KEY]);
}

let saving: Promise<unknown> = Promise.resolve();

/**
 * Stores `change` on top of what is stored and resolves to the result. Saves run one at a
 * time, in the order they were asked for: each reads before it writes, so two at once would
 * lose one of the changes.
 */
export function saveSettings(change: Partial<Settings>): Promise<Settings> {
  const save = saving.then(async () => {
    const settings = parseSettings({ ...(await loadSettings()), ...change });
    await browser.storage.local.set({ [KEY]: settings });
    return settings;
  });
  saving = save.catch(() => {});
  return save;
}
