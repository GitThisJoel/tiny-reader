import { describe, expect, it } from "vitest";
import { clampPosition, SPEEDS, speedChoices, statusText } from "./bar.ts";

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

describe("clampPosition", () => {
  const size = { width: 400, height: 50 };
  const viewport = { width: 1000, height: 600 };

  it("leaves a position inside the window alone", () => {
    expect(clampPosition({ left: 120, top: 80 }, size, viewport)).toEqual({ left: 120, top: 80 });
  });

  it("pulls the bar back inside on every side", () => {
    expect(clampPosition({ left: -30, top: -5 }, size, viewport)).toEqual({ left: 0, top: 0 });
    expect(clampPosition({ left: 900, top: 590 }, size, viewport)).toEqual({ left: 600, top: 550 });
  });

  it("pins a bar wider than the window to its left edge", () => {
    expect(clampPosition({ left: 50, top: 10 }, size, { width: 300, height: 600 })).toEqual({ left: 0, top: 10 });
  });

  it("gives whole pixels", () => {
    expect(clampPosition({ left: 10.6, top: 20.2 }, size, viewport)).toEqual({ left: 11, top: 20 });
  });

  it("stays inside when the bar's size is a fraction of a pixel", () => {
    const { left, top } = clampPosition({ left: 5000, top: 5000 }, { width: 448.48, height: 46.6 }, viewport);
    expect(left + 448.48).toBeLessThanOrEqual(viewport.width);
    expect(top + 46.6).toBeLessThanOrEqual(viewport.height);
    expect([left, top]).toEqual([551, 553]);
  });
});

describe("statusText", () => {
  it("says where the reading is", () => {
    expect(statusText({ status: "playing", index: 2, total: 12 })).toBe("Sentence 3 of 12");
    expect(statusText({ status: "paused", index: 0, total: 3 })).toBe("Sentence 1 of 3");
    expect(statusText({ status: "error", index: 0, total: 0, message: "No." })).toBe("No.");
  });
});
