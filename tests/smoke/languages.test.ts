// The models for other languages, run through the real engine under Node with each one's own
// front end. They are downloads, not part of the repository: a model that is not in
// `.cache/models/` is fetched from its pinned address and verified first.
//
//   pnpm test:smoke
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngine, type Engine } from "../../engine/engine.ts";
import { loadFrontEnd } from "../../engine/frontends.ts";
import { BUNDLED, downloadModel, MODELS, verifyModel } from "../../engine/models.ts";
import { DEFAULT_OPTIONS, HOP } from "../../engine/protocol.ts";
import { readAsset } from "../assets.ts";

const CACHE = join(import.meta.dirname, "../../.cache/models");
async function modelFile(id: string) {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`${id} is not in the list`);
  const path = join(CACHE, `${id}.onnx`);
  const cached = await readFile(path).catch(() => null);
  if (cached) {
    const bytes = new Uint8Array(cached);
    await verifyModel(bytes, model);
    return bytes;
  }
  const bytes = await downloadModel(model);
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, bytes);
  return bytes;
}

describe.each([
  [
    "tiny-voca-ptbr",
    "Oi, tudo bem? Paguei R$ 15,50 às 10h30.",
    ["Oi", "tudo", "bem", "Paguei", "R$ 15,50", "às", "10h30"],
  ],
  ["vocina", "L'amico arriva alle 14:35, poi parte.", ["L'amico", "arriva", "alle", "14:35", "poi", "parte"]],
])("%s", (id, text, sourceWords) => {
  const model = MODELS.find((entry) => entry.id === id) ?? BUNDLED;
  let engine: Engine;
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    engine = await createEngine(ort, {
      model: await modelFile(id),
      frontEnd: await loadFrontEnd(model.frontend, readAsset),
    });
  }, 120_000);

  it.each(model.voices.map((name, index) => [name, index] as const))("speaks with voice %s", async (_, voice) => {
    const result = await engine.speak(text, { ...DEFAULT_OPTIONS, voice });
    if (!result) throw new Error("no result");
    expect(result.pcm.every(Number.isFinite)).toBe(true);
    expect(result.pcm.length % HOP).toBe(0);
    const seconds = result.pcm.length / result.sampleRate;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(12);
    const peak = result.pcm.reduce((top, sample) => Math.max(top, Math.abs(sample)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(0.99 + 1e-6);
    // Every source word is timed, the amounts over all of their expansion, in order.
    expect(result.words.map((word) => text.slice(word.charStart, word.charEnd))).toEqual(sourceWords);
    let previous = 0;
    for (const word of result.words) {
      expect(word.start).toBeGreaterThanOrEqual(previous);
      expect(word.end).toBeGreaterThan(word.start);
      previous = word.end;
    }
    expect(previous).toBeLessThanOrEqual(seconds);
  });
});
