import { describe, expect, it } from "vitest";
import { SPEEDS, speedChoices, statusText } from "./bar.ts";

describe("speedChoices", () => {
  it("offers the presets when the speed in use is one of them", () => {
    expect(speedChoices(1)).toBe(SPEEDS);
    expect(speedChoices(1.75)).toBe(SPEEDS);
  });

  it("adds a speed set on the options page, in order, so the bar can show it", () => {
    expect(speedChoices(1.1)).toEqual([0.75, 1, 1.1, 1.25, 1.5, 1.75, 2]);
    expect(speedChoices(0.5)).toEqual([0.5, ...SPEEDS]);
    expect(SPEEDS).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});

describe("statusText", () => {
  it("says where the reading is", () => {
    expect(statusText({ status: "playing", index: 2, total: 12 })).toBe("Sentence 3 of 12");
    expect(statusText({ status: "paused", index: 0, total: 3 })).toBe("Sentence 1 of 3");
    expect(statusText({ status: "error", index: 0, total: 0, message: "No." })).toBe("No.");
  });
});
