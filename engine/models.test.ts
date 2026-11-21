import { describe, expect, it, vi } from "vitest";
import { ASSETS } from "../scripts/fetch-assets.ts";
import { frontEnd } from "./engine.ts";
import {
  BUNDLED,
  checkIo,
  downloadModel,
  MODELS,
  type Model,
  ModelError,
  modelById,
  modelUrl,
  verifyModel,
} from "./models.ts";
import { loadPhonemizer } from "./phonemizer.ts";

describe("the list of models", () => {
  it("starts with the bundled model, at the revision and hash fetch-assets pins", () => {
    expect(MODELS[0]).toBe(BUNDLED);
    const shipped = ASSETS.find((asset) => asset.path === "public/assets/model.onnx");
    expect(shipped).toMatchObject({ url: modelUrl(BUNDLED), sha256: BUNDLED.sha256 });
  });

  it("offers SobbieTTS and fiato besides it, and nothing else", () => {
    expect(MODELS.map((model) => model.repo)).toEqual([
      "n4ze3m/tiny-voca",
      "PatnaikAshish/SobbieTTS",
      "cfahlgren1/fiato",
    ]);
  });

  it("pins every model to a commit and a SHA-256, on Hugging Face over https", () => {
    for (const model of MODELS) {
      expect(model.revision, model.id).toMatch(/^[0-9a-f]{40}$/);
      expect(model.sha256, model.id).toMatch(/^[0-9a-f]{64}$/);
      expect(model.size, model.id).toBeGreaterThan(1e6);
      expect(model.url, model.id).toBeUndefined();
      expect(modelUrl(model)).toBe(`https://huggingface.co/${model.repo}/resolve/${model.revision}/onnx/model.onnx`);
      expect(model.source).toBe(`https://huggingface.co/${model.repo}`);
      // What the engine and its English phonemizer can speak, under a licence that lets it be passed on.
      expect(model).toMatchObject({ language: "en", frontend: "dizione", licence: "Apache-2.0" });
      // Every listed model names a text front end the engine has.
      expect(frontEnd(model.frontend), model.id).toBeTypeOf("function");
      expect(model.voices.length, model.id).toBeGreaterThan(0);
    }
    expect(new Set(MODELS.map((model) => model.id)).size).toBe(MODELS.length);
    expect(new Set(MODELS.map((model) => model.sha256)).size).toBe(MODELS.length);
  });

  it("finds a model by its id, and nothing for anything else", () => {
    expect(modelById("fiato")?.voices).toEqual(["F1", "M1"]);
    for (const id of ["", "nope", undefined, null, 3, {}]) expect(modelById(id)).toBeUndefined();
  });
});

/** A model entry for `bytes`, and a server that answers with them in pieces. */
async function fixture(bytes: Uint8Array<ArrayBuffer>, served = bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const model: Model = {
    ...BUNDLED,
    id: "test",
    size: bytes.length,
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  const get = vi.fn(async () => {
    const pieces = [served.subarray(0, 3), served.subarray(3)];
    return new Response(
      new ReadableStream({ pull: (stream) => (pieces.length ? stream.enqueue(pieces.shift()) : stream.close()) }),
    );
  });
  return { model, get: get as unknown as typeof fetch, calls: get.mock.calls as unknown[][] };
}
const BYTES = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);

describe("verifyModel", () => {
  it("accepts exactly the pinned file", async () => {
    const { model } = await fixture(BYTES);
    await expect(verifyModel(BYTES, model)).resolves.toBeUndefined();
  });

  it("refuses a file of another length, and one of the right length with one byte changed", async () => {
    const { model } = await fixture(BYTES);
    await expect(verifyModel(BYTES.subarray(1), model)).rejects.toThrow(/7 bytes long, not the 8 expected/);
    await expect(verifyModel(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 9), model)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("downloadModel", () => {
  it("fetches the pinned address without cookies, reports progress and returns the verified file", async () => {
    const { model, get, calls } = await fixture(BYTES);
    const progress: number[] = [];
    expect(await downloadModel(model, (received) => progress.push(received), undefined, get)).toEqual(BYTES);
    expect(progress).toEqual([3, 8]);
    expect(calls).toEqual([[modelUrl(BUNDLED), { credentials: "omit", signal: undefined }]]);
  });

  it("returns nothing when what was served is not the pinned file", async () => {
    for (const served of [Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 9), BYTES.subarray(0, 5)]) {
      const { model, get } = await fixture(BYTES, served);
      await expect(downloadModel(model, undefined, undefined, get)).rejects.toBeInstanceOf(ModelError);
    }
  });

  it("stops at the expected size, however much the server sends", async () => {
    const { model, get } = await fixture(BYTES, new Uint8Array(1000));
    await expect(downloadModel(model, undefined, undefined, get)).rejects.toThrow(/longer than the 8 bytes expected/);
  });

  it("says which host failed, and how", async () => {
    const { model } = await fixture(BYTES);
    const missing = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(downloadModel(model, undefined, undefined, missing)).rejects.toThrow(
      "huggingface.co answered with error 404.",
    );
    const offline = (async () => Promise.reject(new TypeError("NetworkError"))) as unknown as typeof fetch;
    await expect(downloadModel(model, undefined, undefined, offline)).rejects.toThrow(
      "Tiny Reader could not reach huggingface.co.",
    );
  });
});

describe("frontEnd", () => {
  it("gives the bundled English front end for the name the list uses", () => {
    expect(frontEnd("dizione")).toBe(loadPhonemizer);
  });

  it("refuses a front end this build does not have, saying which", () => {
    for (const name of ["espeak-de", "", "Dizione", "toString"]) expect(() => frontEnd(name)).toThrow(ModelError);
    expect(() => frontEnd("espeak-de")).toThrow(
      'it needs the text front end "espeak-de", which this version of Tiny Reader does not have',
    );
  });
});

describe("checkIo", () => {
  const tensor = (name: string, type: string) => ({ name, type, isTensor: true });
  const inputs = [
    tensor("tokens", "int64"),
    tensor("stress", "int64"),
    tensor("voice", "int64"),
    tensor("speed", "float32"),
    tensor("pitch_shift", "float32"),
    tensor("pitch_range", "float32"),
  ];
  const outputs = [tensor("audio", "float32"), tensor("durations", "int64")];

  it("accepts the inputs and outputs of a tiny-voca model, in any order", () => {
    expect(() => checkIo({ inputMetadata: inputs, outputMetadata: outputs })).not.toThrow();
    expect(() => checkIo({ inputMetadata: inputs.toReversed(), outputMetadata: outputs.toReversed() })).not.toThrow();
  });

  it("refuses a missing, extra, renamed or retyped input or output", () => {
    const refused = [
      { inputMetadata: inputs.slice(1), outputMetadata: outputs },
      { inputMetadata: [...inputs, tensor("emotion", "int64")], outputMetadata: outputs },
      {
        inputMetadata: inputs.map((input) => (input.name === "speed" ? tensor("speed", "float64") : input)),
        outputMetadata: outputs,
      },
      { inputMetadata: inputs, outputMetadata: [tensor("audio", "float32")] },
      { inputMetadata: inputs, outputMetadata: [tensor("audio", "float32"), { name: "durations", isTensor: false }] },
    ];
    for (const io of refused) expect(() => checkIo(io)).toThrow(ModelError);
    expect(() => checkIo(refused[0] ?? { inputMetadata: [], outputMetadata: [] })).toThrow(
      /^its inputs are \(pitch_range: float32, /,
    );
  });
});
