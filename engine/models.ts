// The voice models Tiny Reader can use. This list is all there is: nothing outside it can be
// downloaded. A model belongs here only if it works with the engine and a text front end the
// add-on has (same token table, inputs, outputs and sample rate). Today that is one: the bundled
// English phonemizer. Another language would need its front end's code inside the package and
// entries here that name it. See docs/FINDINGS.md §13.

export interface Model {
  id: string;
  name: string;
  /** BCP 47. */
  language: string;
  /** In the order of the model's `voice` input. */
  voices: readonly string[];
  /**
   * The text front end the model was trained with: the code that turns text into its tokens.
   * The engine has to have it (engine/engine.ts). This list is the authority, not the model's own
   * `config.json`, which has been seen to claim a front end it does not match.
   */
  frontend: string;
  /** SPDX identifier. */
  licence: string;
  /** The model's page, for people. */
  source: string;
  /** Hugging Face repository, the commit it is pinned to (never a branch), and the ONNX file in it. */
  repo: string;
  revision: string;
  file: string;
  /** Bytes and SHA-256 of that file. A download that differs is not stored. */
  size: number;
  sha256: string;
  /** Where to download from instead of Hugging Face. Only the end-to-end tests' stand-in has one. */
  url?: string;
}

const english = (model: Omit<Model, "language" | "frontend" | "licence" | "file" | "source">): Model => ({
  language: "en",
  frontend: "dizione",
  licence: "Apache-2.0",
  file: "onnx/model.onnx",
  source: `https://huggingface.co/${model.repo}`,
  ...model,
});

/** Ships inside the add-on (public/assets/model.onnx, fetched by scripts/fetch-assets.ts). Never downloaded. */
export const BUNDLED = english({
  id: "tiny-voca",
  name: "tiny-voca",
  voices: ["F2", "M2"],
  repo: "n4ze3m/tiny-voca",
  revision: "1e73262226dbf4ef02e9df277e81aaa1db5ce16c",
  size: 21_386_372,
  sha256: "fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46",
});

/**
 * The end-to-end tests make a build of their own with one more entry, a stand-in served by the
 * local test site (tests/e2e/models.test.ts). In every other build this is undefined.
 */
const standIn: string | undefined = import.meta.env.VITE_E2E_MODEL;

export const MODELS: readonly Model[] = [
  BUNDLED,
  english({
    id: "sobbie",
    name: "SobbieTTS",
    voices: ["F", "M"],
    repo: "PatnaikAshish/SobbieTTS",
    revision: "6b6132c6d34b5fc163d8f5553580678a60532ac3",
    size: 21_386_372,
    sha256: "eafb38b736c17872091c0f05de87814257925a9c3c5aeff168c74afc496d9317",
  }),
  english({
    id: "fiato",
    name: "fiato",
    voices: ["F1", "M1"],
    repo: "cfahlgren1/fiato",
    revision: "967de50b6a9ab673ef7de9f8f276fa93a8c0db81",
    size: 21_388_682,
    sha256: "179df2e1ede3935d4f928c0757947b25eb1f678ff347aef90e2efdf7ffb0048c",
  }),
  ...(standIn ? [JSON.parse(standIn) as Model] : []),
];

export const modelById = (id: unknown): Model | undefined => MODELS.find((model) => model.id === id);

export const modelUrl = (model: Model): string =>
  model.url ?? `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`;

/** Why a model could not be downloaded or used. The message is for the user. */
export class ModelError extends Error {}

/** Throws unless `bytes` is exactly the file the list pins for `model`. */
export async function verifyModel(bytes: Uint8Array<ArrayBuffer>, model: Model) {
  if (bytes.length !== model.size)
    throw new ModelError(`The download is ${bytes.length} bytes long, not the ${model.size} expected.`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== model.sha256) throw new ModelError("The download is not the file Tiny Reader expects.");
}

/**
 * Downloads a model's file and resolves to it only once it has been verified. Nothing is sent
 * but the request itself: no cookies, no body. `onProgress` is told the bytes received so far.
 * The caller holds the host permission for the site, so that Firefox adds no Origin header.
 */
export async function downloadModel(
  model: Model,
  onProgress: (received: number) => void = () => {},
  signal?: AbortSignal,
  get: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const host = new URL(modelUrl(model)).hostname;
  const response = await get(modelUrl(model), { credentials: "omit", signal }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new ModelError(`Tiny Reader could not reach ${host}.`);
  });
  if (!response.ok || !response.body) throw new ModelError(`${host} answered with error ${response.status}.`);
  // Never more than the size expected, whatever the server sends.
  const bytes = new Uint8Array(model.size);
  let received = 0;
  const reader = response.body.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (received + chunk.value.length > model.size) {
      void reader.cancel();
      throw new ModelError(`The download is longer than the ${model.size} bytes expected.`);
    }
    bytes.set(chunk.value, received);
    received += chunk.value.length;
    onProgress(received);
  }
  await verifyModel(bytes.subarray(0, received), model);
  return bytes;
}

/** What the engine feeds a model and reads back. See docs/FINDINGS.md §1. */
const INPUTS = {
  tokens: "int64",
  stress: "int64",
  voice: "int64",
  speed: "float32",
  pitch_shift: "float32",
  pitch_range: "float32",
};
const OUTPUTS = { audio: "float32", durations: "int64" };

/** The part of an ONNX Runtime session that tells what a model takes and gives. */
export interface ModelIo {
  inputMetadata: readonly { name: string; isTensor: boolean; type?: string }[];
  outputMetadata: readonly { name: string; isTensor: boolean; type?: string }[];
}

/** Throws unless the model has exactly the inputs and outputs the engine works with. */
export function checkIo(session: ModelIo) {
  const describe = (values: ModelIo["inputMetadata"]) =>
    values
      .map((value) => `${value.name}: ${value.isTensor ? value.type : "not a tensor"}`)
      .sort()
      .join(", ");
  const expect = (names: Record<string, string>) =>
    describe(Object.entries(names).map(([name, type]) => ({ name, type, isTensor: true })));
  for (const [kind, actual, expected] of [
    ["inputs", describe(session.inputMetadata), expect(INPUTS)],
    ["outputs", describe(session.outputMetadata), expect(OUTPUTS)],
  ] as const)
    if (actual !== expected) throw new ModelError(`its ${kind} are (${actual}), not (${expected})`);
}
