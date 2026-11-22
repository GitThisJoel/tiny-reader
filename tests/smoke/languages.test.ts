// The models for other languages, run through the real engine under Node with each one's own
// front end. They are downloads, not part of the repository: a model that is not in
// `.cache/models/` is fetched from its pinned address and verified first.
//
//   pnpm test:smoke
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngine, type Engine } from "../../engine/engine.ts";
import { loadFrontEnd } from "../../engine/frontends.ts";
import { BUNDLED, MODELS } from "../../engine/models.ts";
import { DEFAULT_OPTIONS, HOP } from "../../engine/protocol.ts";
import { cached, readAsset } from "../assets.ts";

describe.each([
  [
    "tiny-voca-ptbr",
    "Oi, tudo bem? Paguei R$ 15,50 às 10h30.",
    ["Oi", "tudo", "bem", "Paguei", "R$ 15,50", "às", "10h30"],
  ],
  ["vocina", "L'amico arriva alle 14:35, poi parte.", ["L'amico", "arriva", "alle", "14:35", "poi", "parte"]],
  [
    "tiny-voca-es",
    "Hola, ¿cómo estás? El tren sale a las 14:35.",
    ["Hola", "cómo", "estás", "El tren sale a las 14:35"],
  ],
  ["apptor-de", "Hallo, der Zug fährt um 14:35 Uhr ab.", ["Hallo", "der", "Zug", "fährt", "um", "14:35", "Uhr", "ab"]],
  [
    "zerre-tts",
    "Merhaba, bugün nasılsın? Tren saat onda kalkıyor.",
    ["Merhaba", "bugün", "nasılsın", "Tren", "saat", "onda", "kalkıyor"],
  ],
  ["tiny-swara", "আমি ভাত খাই। আপনার order টি আসবে।", ["আমি", "ভাত", "খাই", "আপনার", "order", "টি", "আসবে"]],
  ["tui-voice-ml", "ഹലോ, സുഖമാണോ? എവിടെയാണ് ഇപ്പോൾ?", ["ഹലോ", "സുഖമാണോ", "എവിടെയാണ്", "ഇപ്പോൾ"]],
  [
    "apptor-de-at",
    "Servus, im Kaffeehaus kostet der Kaffee 3 Euro.",
    ["Servus", "im", "Kaffeehaus", "kostet", "der", "Kaffee", "3", "Euro"],
  ],
  [
    "tiny-voca-fr",
    "Bonjour, comment allez-vous ? Cela coûte 15 euros.",
    ["Bonjour", "comment", "allez-vous", "Cela", "coûte", "15", "euros"],
  ],
])("%s", (id, text, sourceWords) => {
  const model = MODELS.find((entry) => entry.id === id) ?? BUNDLED;
  let engine: Engine;
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    const helper = model.helper && (await cached(model.helper, `${id}.helper.onnx`));
    engine = await createEngine(ort, {
      model: await cached(model, `${id}.onnx`),
      frontEnd: await loadFrontEnd(model.frontend, readAsset, {
        ort,
        helper: async () => helper ?? null,
        inputs: model.inputs,
      }),
      inputs: model.inputs,
      trimTail: model.trimTail,
    });
  }, 120_000);

  it.each(model.voices.map((name, index) => [name, index] as const))("speaks with voice %s", async (_, voice) => {
    const result = await engine.speak(text, { ...DEFAULT_OPTIONS, voice });
    if (!result) throw new Error("no result");
    expect(result.pcm.every(Number.isFinite)).toBe(true);
    const seconds = result.pcm.length / result.sampleRate;
    // Whole frames, unless the end is trimmed: then it stops within 40 ms of a 10 ms step.
    if (!model.trimTail) expect(result.pcm.length % HOP).toBe(0);
    expect(result.words.at(-1)?.end).toBeLessThanOrEqual(seconds);
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
