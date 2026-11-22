import { describe, expect, it, vi } from "vitest";
import { ASSETS, sha256 } from "../scripts/fetch-assets.ts";
import {
  BUNDLED,
  checkIo,
  downloadModel,
  helperKey,
  languageName,
  MODELS,
  type Model,
  ModelError,
  modelById,
  readsOnly,
  verifyModel,
} from "./models.ts";

describe("the list of models", () => {
  it("starts with the bundled model, at the revision and hash fetch-assets pins", () => {
    expect(MODELS[0]).toBe(BUNDLED);
    const shipped = ASSETS.find((asset) => asset.path === "public/assets/model.onnx");
    expect(shipped).toMatchObject({ url: BUNDLED.url, sha256: BUNDLED.sha256 });
  });

  it("offers these models and nothing else, each with the front end of its language", () => {
    expect(MODELS.map((model) => [model.id, model.language, model.frontend])).toEqual([
      ["tiny-voca", "en", "dizione"],
      ["sobbie", "en", "dizione"],
      ["fiato", "en", "dizione"],
      ["tiny-voca-ptbr", "pt-BR", "dizione-ptbr"],
      ["vocina", "it", "g2p-it"],
      ["tiny-voca-es", "es-ES", "espeak-es"],
      ["tiny-voca-fr", "fr", "espeak-fr"],
      ["apptor-de", "de", "g2p-de"],
      ["zerre-tts", "tr", "espeak-tr"],
      ["tiny-swara", "bn", "espeak-bn"],
      ["tui-voice-ml", "ml", "espeak-ml"],
      ["apptor-de-at", "de-AT", "g2p-de-at"],
    ]);
  });

  it("pins every model to an address that cannot drift unnoticed, and to a SHA-256", () => {
    for (const model of MODELS) {
      // A commit on Hugging Face, or a release tag on GitHub; over https either way.
      expect(model.url, model.id).toMatch(
        /^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\/|^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/v[\d.]+\//,
      );
      expect(model.url.startsWith(model.source), model.id).toBe(true);
      expect(model.sha256, model.id).toMatch(/^[0-9a-f]{64}$/);
      expect(model.size, model.id).toBeGreaterThan(1e6);
      // Licences that let the file be passed on; the credit they ask for is shown with the model.
      expect(["Apache-2.0", "CC-BY-4.0"], model.id).toContain(model.licence);
      expect(model.author, model.id).not.toBe("");
      expect(model.voices.length, model.id).toBeGreaterThan(0);
      // Only a site that sends no CORS headers needs more than its own address allowed.
      expect(model.alsoAllow ?? [], model.id).toEqual(
        model.url.startsWith("https://github.com/") ? ["https://release-assets.githubusercontent.com/*"] : [],
      );
    }
    // A helper file is pinned like the model, in the same repository at the same commit.
    for (const { id, url, helper } of MODELS.filter((model) => model.helper)) {
      expect(helper?.url.slice(0, helper.url.lastIndexOf("/")), id).toBe(url.slice(0, url.lastIndexOf("/")));
      expect(helper?.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(helper?.size, id).toBeGreaterThan(1e6);
      expect(helperKey(id)).toBe(`${id}/helper`);
    }
    expect(new Set(MODELS.map((model) => model.id)).size).toBe(MODELS.length);
    expect(new Set(MODELS.map((model) => model.sha256)).size).toBe(MODELS.length);
  });

  it("finds a model by its id, and nothing for anything else", () => {
    expect(modelById("fiato")?.voices).toEqual(["F1", "M1"]);
    for (const id of ["", "nope", undefined, null, 3, {}]) expect(modelById(id)).toBeUndefined();
  });

  it("names each model's language, for the settings and for warnings", () => {
    expect(MODELS.map(languageName)).toEqual([
      "English",
      "English",
      "English",
      "Brazilian Portuguese",
      "Italian",
      "European Spanish",
      "French",
      "German",
      "Turkish",
      "Bangla",
      "Malayalam",
      "Austrian German",
    ]);
    expect(readsOnly(BUNDLED)).toBe("tiny-voca only reads English");
    expect(readsOnly(MODELS[4] ?? BUNDLED)).toBe("vocina only reads Italian");
  });
});

/** A model entry for `bytes`, and a server that answers with them in pieces. */
async function fixture(bytes: Uint8Array<ArrayBuffer>, served = bytes) {
  const model: Model = { ...BUNDLED, id: "test", size: bytes.length, sha256: sha256(bytes) };
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
    expect(calls).toEqual([[BUNDLED.url, { credentials: "omit", signal: undefined }]]);
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
    // The connection drops after the first piece.
    let served = false;
    const dropped = (async () =>
      new Response(
        new ReadableStream({
          pull(stream) {
            if (served) stream.error(new TypeError("NetworkError"));
            else stream.enqueue(BYTES.subarray(0, 3));
            served = true;
          },
        }),
      )) as unknown as typeof fetch;
    const failure = downloadModel(model, undefined, undefined, dropped);
    await expect(failure).rejects.toThrow("The download from huggingface.co broke off.");
    await expect(failure).rejects.toBeInstanceOf(ModelError);
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

  it("accepts a further input only for a model whose list entry names it", () => {
    const withAccent = { inputMetadata: [...inputs, tensor("accent", "float32")], outputMetadata: outputs };
    expect(() => checkIo(withAccent, ["accent"])).not.toThrow();
    expect(() => checkIo(withAccent)).toThrow(/accent: float32/);
    // Named but not there, or there with another type: refused too.
    expect(() => checkIo({ inputMetadata: inputs, outputMetadata: outputs }, ["accent"])).toThrow(ModelError);
    expect(() =>
      checkIo({ inputMetadata: [...inputs, tensor("accent", "int64")], outputMetadata: outputs }, ["accent"]),
    ).toThrow(ModelError);
    // The Austrian model is the one entry with such an input.
    expect(MODELS.filter((model) => model.inputs).map((model) => [model.id, model.inputs])).toEqual([
      ["apptor-de-at", { accent: 1 }],
    ]);
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
