// The stand-in model the end-to-end tests download, run through the real engine under Node:
// a model with the right inputs and outputs is used, one without is refused before it is.
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "../../engine/engine.ts";
import { type FrontEnd, loadFrontEnd } from "../../engine/frontends.ts";
import { ModelError } from "../../engine/models.ts";
import { DEFAULT_OPTIONS, HOP } from "../../engine/protocol.ts";
import { readAsset } from "../assets.ts";
import { standInModel } from "../stand-in-model.ts";

let frontEnd: FrontEnd;
beforeAll(async () => {
  ort.env.wasm.numThreads = 1;
  frontEnd = await loadFrontEnd("dizione", readAsset);
});

describe("a model other than the bundled one", () => {
  it("speaks through the engine when its inputs and outputs are the expected ones", async () => {
    const engine = await createEngine(ort, { model: standInModel(), frontEnd });
    const text = "Hello! This is tiny voca.";
    const result = await engine.speak(text, { ...DEFAULT_OPTIONS, voice: 1 });
    if (!result) throw new Error("no result");
    expect(result.pcm.length % HOP).toBe(0);
    expect(result.pcm.every((sample) => Math.abs(sample - 0.1) < 1e-6)).toBe(true);
    expect(result.words.map((word) => text.slice(word.charStart, word.charEnd))).toEqual([
      "Hello",
      "This",
      "is",
      "tiny",
      "voca",
    ]);
    expect(result.words.at(-1)?.end).toBeLessThanOrEqual(result.pcm.length / result.sampleRate);
    await engine.release();
  });

  it("is refused when an input has another name", async () => {
    const refused = createEngine(ort, { model: standInModel("speaker"), frontEnd });
    await expect(refused).rejects.toBeInstanceOf(ModelError);
    await expect(refused).rejects.toThrow(/its inputs are \(.*speaker: int64.*\), not \(.*voice: int64.*\)/);
  });

  it("is refused when it is not a model at all", async () => {
    await expect(createEngine(ort, { model: Uint8Array.of(1, 2, 3), frontEnd })).rejects.toThrow();
  });
});
