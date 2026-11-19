// Token-id parity with the Python reference (dizione). Fixtures come from
// scripts/gen-parity-fixtures.py; see the README for how to regenerate them.
import { beforeAll, describe, expect, it } from "vitest";
import { type Phonemizer, phonemize } from "../../engine/phonemizer.ts";
import { testPhonemizer } from "../assets.ts";
import fixtures from "./fixtures.json" with { type: "json" };

/**
 * Inputs where upstream's JS port is intentionally ahead of the pinned Python commit: it no
 * longer puts a sentence-final stop after each initial of a name (docs/FINDINGS.md §3).
 * For these the expected ids are the recorded JS output. Remove an entry once Python dizione
 * publishes the fix and the fixtures are regenerated.
 */
const KNOWN_DIVERGENT: Record<string, { ids: number[]; stress: number[] }> = {
  "H. C. Sirr wrote it.": {
    ids: [1, 59, 39, 27, 49, 3, 27, 58, 3, 36, 62, 19, 3, 47, 19, 6, 2],
    stress: [0, 2, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  },
  "F. A. McKenzie wrote it.": {
    ids: [1, 50, 23, 59, 3, 32, 43, 21, 50, 33, 28, 48, 3, 36, 62, 19, 3, 47, 19, 6, 2],
    stress: [0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  },
};

let phonemizer: Phonemizer;
beforeAll(async () => {
  phonemizer = await testPhonemizer();
});

describe("phonemizer parity with Python dizione", () => {
  it("has a useful number of fixtures", () => {
    expect(fixtures.cases.length).toBeGreaterThan(200);
  });

  it("gives identical ids and stress for every fixture", () => {
    const different: unknown[] = [];
    for (const expected of fixtures.cases) {
      const want = KNOWN_DIVERGENT[expected.text] ?? expected;
      const got = phonemize(phonemizer, expected.text);
      const same =
        want.ids === null
          ? got === null
          : got !== null && got.ids.join() === want.ids.join() && got.stress.join() === want.stress?.join();
      if (!same)
        different.push({
          text: expected.text,
          ids: got?.ids,
          stress: got?.stress,
        });
    }
    expect(different).toEqual([]);
  });

  it("still needs every known divergence", () => {
    for (const [text, recorded] of Object.entries(KNOWN_DIVERGENT)) {
      const python = fixtures.cases.find((item) => item.text === text);
      expect(python, text).toBeDefined();
      expect(python?.ids?.join(), text).not.toBe(recorded.ids.join());
    }
  });
});
