import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WordTiming } from "@/engine/align.ts";
import { WordTracker } from "./word-tracker.ts";

const WORDS: WordTiming[] = [
  { charStart: 0, charEnd: 3, start: 0.3, end: 0.6 },
  { charStart: 4, charEnd: 7, start: 0.9, end: 1.2 },
];

let frames: (() => void)[] = [];
/** Runs the animation frame that is waiting. */
const frame = () => frames.shift()?.();
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("WordTracker", () => {
  it("reports each word once, when playback reaches it", () => {
    let position = 0;
    const seen: (number | null)[] = [];
    const tracker = new WordTracker(
      () => position,
      (word) => seen.push(word?.charStart ?? null),
    );
    tracker.follow(WORDS);
    expect(seen).toEqual([]); // before the first word
    for (position of [0.2, 0.35, 0.5, 0.7, 0.95, 1.5]) frame();
    expect(seen).toEqual([0, 4]);
  });

  it("clears the word and stops asking for frames on stop", () => {
    const seen: (number | null)[] = [];
    const tracker = new WordTracker(
      () => 1,
      (word) => seen.push(word?.charStart ?? null),
    );
    tracker.follow(WORDS);
    tracker.stop();
    expect(seen).toEqual([4, null]);
    expect(frames).toEqual([]);
    tracker.stop();
    expect(seen).toEqual([4, null]);
  });

  it("starts over for a new sentence", () => {
    let position = 1;
    const seen: (number | null)[] = [];
    const tracker = new WordTracker(
      () => position,
      (word) => seen.push(word?.charStart ?? null),
    );
    tracker.follow(WORDS);
    position = 0.4;
    tracker.follow(WORDS);
    expect(seen).toEqual([4, null, 0]);
    expect(frames).toHaveLength(1);
  });

  it("does nothing without word timings", () => {
    const tracker = new WordTracker(
      () => 0,
      () => {
        throw new Error("unexpected");
      },
    );
    tracker.follow([]);
    expect(frames).toEqual([]);
  });
});
