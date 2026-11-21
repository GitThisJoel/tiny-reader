// The German front end against apptor's own Python front end: tests/parity/german.json, written
// by `pnpm german-fixtures`. Both read words with the same letter-to-sound model, which this
// test downloads once (12 MB, verified) into `.cache/models/`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { type FrontEnd, loadFrontEnd } from "../../engine/frontends.ts";
import { MODELS } from "../../engine/models.ts";
import { cached, readAsset } from "../assets.ts";

describe("German (apptor)", () => {
  let frontEnd: FrontEnd;
  let reference: { symbols: string[]; sentences: { text: string; ids: number[]; stress: number[] }[] };
  let model: { symbols: string[] };
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    const german = MODELS.find((entry) => entry.id === "apptor-de");
    if (!german?.helper) throw new Error("the German model has no helper in the list");
    const helper = await cached(german.helper, "apptor-de.helper.onnx");
    frontEnd = await loadFrontEnd("g2p-de", readAsset, { ort, helper: async () => helper });
    reference = JSON.parse(await readFile(join(import.meta.dirname, "german.json"), "utf8"));
    model = JSON.parse(await readFile(join(import.meta.dirname, "../../vendor/apptor/model.json"), "utf8"));
  }, 120_000);

  it("gives the ids and stress of the Python front end", async () => {
    expect(reference.sentences.length).toBeGreaterThanOrEqual(50);
    for (const sentence of reference.sentences) {
      const result = await frontEnd(sentence.text);
      expect(result?.ids, sentence.text).toEqual(sentence.ids);
      expect(result?.stress, sentence.text).toEqual(sentence.stress);
    }
  });

  it("uses the symbol table the released model was trained with", () => {
    expect(reference.symbols).toEqual(model.symbols);
  });

  it("names every spoken word", async () => {
    for (const sentence of reference.sentences)
      expect(
        (await frontEnd(sentence.text))?.words.every((word) => word.text),
        sentence.text,
      ).toBe(true);
  });
});
