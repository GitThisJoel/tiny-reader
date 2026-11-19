import type { WordTiming } from "./align.ts";

export type { WordTiming };

// Messages between a page (content script or extension page) and the engine.
// Page ⇄ background travels over a runtime.Port named PORT_NAME; background ⇄ Worker over
// postMessage. Both legs carry the same shapes.

export const PORT_NAME = "engine";
export const SAMPLE_RATE = 24000;
/** Samples per duration frame. */
export const HOP = 256;
export const VOICES = ["F2", "M2"] as const;

export interface SynthOptions {
  /** Index into VOICES. */
  voice: number;
  /** 1 = as predicted, 2 = twice as fast. */
  speed: number;
  /** Added to log F0. 0.058 is about one semitone. */
  pitchShift: number;
  /** Scales pitch movement around the mean. 1 = as predicted. */
  pitchRange: number;
}

export const DEFAULT_OPTIONS: SynthOptions = {
  voice: 0,
  speed: 1,
  pitchShift: 0,
  pitchRange: 1,
};
export const LIMITS = {
  speed: [0.5, 2],
  pitchShift: [-0.5, 0.5],
  pitchRange: [0, 2],
} as const;

export type EngineRequest =
  | { type: "synthesize"; id: string; text: string; options: SynthOptions }
  /** Drop one request. No result or error is sent for it afterwards. */
  | { type: "cancel"; id: string }
  /** Drop every request whose id starts with `prefix` ("" drops all). */
  | { type: "cancelAll"; prefix: string }
  /** Keeps the background event page, and so the loaded engine, alive. */
  | { type: "ping" };

export type EngineErrorCode = "nothing-to-pronounce" | "failed";

/** One synthesized sentence. */
export interface Utterance {
  /** Mono samples at `sampleRate`, peak at most 0.99. */
  pcm: Float32Array;
  sampleRate: number;
  /** When each word of the source text is heard. */
  words: WordTiming[];
}

export type EngineResponse =
  | ({ type: "result"; id: string } & Utterance)
  | { type: "error"; id: string; code: EngineErrorCode; message: string }
  /** Sent while the model is being loaded for the first request, and when it is ready. */
  | { type: "status"; state: "loading" | "ready" };

const MAX_TEXT = 20_000;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const inRange = (value: unknown, [low, high]: readonly [number, number]): value is number =>
  typeof value === "number" && value >= low && value <= high;

function parseOptions(value: unknown): SynthOptions | null {
  if (!isObject(value)) return null;
  const { voice, speed, pitchShift, pitchRange } = value;
  if (typeof voice !== "number" || !Number.isInteger(voice) || voice < 0 || voice >= VOICES.length) return null;
  if (!inRange(speed, LIMITS.speed)) return null;
  if (!inRange(pitchShift, LIMITS.pitchShift) || !inRange(pitchRange, LIMITS.pitchRange)) return null;
  return { voice, speed, pitchShift, pitchRange };
}

/** Validates an incoming message. Anything malformed or out of range gives null. */
export function parseRequest(value: unknown): EngineRequest | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "synthesize": {
      const options = parseOptions(value.options);
      if (typeof value.id !== "string" || typeof value.text !== "string" || !options) return null;
      if (value.text.length > MAX_TEXT) return null;
      return { type: "synthesize", id: value.id, text: value.text, options };
    }
    case "cancel":
      return typeof value.id === "string" ? { type: "cancel", id: value.id } : null;
    case "cancelAll":
      return typeof value.prefix === "string" ? { type: "cancelAll", prefix: value.prefix } : null;
    case "ping":
      return { type: "ping" };
    default:
      return null;
  }
}
