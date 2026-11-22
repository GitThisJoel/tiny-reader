// The voice models Tiny Reader can use. This list is all there is: nothing outside it can be
// downloaded. A model belongs here only if it works with the engine (same inputs, outputs and
// sample rate) and with a text front end the add-on has (engine/frontends.ts), whose token
// table is the model's. A new language means that front end's code inside the package and
// entries here that name it. See docs/FINDINGS.md §13 and §14.

/** A file to download: where from, and exactly which bytes. One that differs is not stored. */
export interface PinnedFile {
  /** An address that is pinned: a commit on Hugging Face, a release tag on GitHub. */
  url: string;
  size: number;
  sha256: string;
}

export interface Model extends PinnedFile {
  id: string;
  name: string;
  /** Who made it, as its page names them. Shown with the model: some licences ask for the credit. */
  author: string;
  /** BCP 47. */
  language: string;
  /**
   * The text front end the model was trained with: the code that turns text into its tokens.
   * The engine has to have it (engine/frontends.ts). This list is the authority, not the model's
   * own `config.json`, which has been seen to claim a front end it does not match.
   */
  frontend: string;
  /** In the order of the model's `voice` input. */
  voices: readonly string[];
  /** SPDX identifier. */
  licence: string;
  /** The model's page, for people. */
  source: string;
  /**
   * A second file the model's front end needs, downloaded, verified and stored with the model.
   * It is data: the German front end's letter-to-sound model. Front-end code is never downloaded.
   */
  helper?: PinnedFile;
  /**
   * What the model's makers set where Tiny Reader's settings are neutral: added to the pitch,
   * and multiplied into the pitch range.
   */
  tuning?: { pitchShift: number; pitchRange: number };
  /**
   * Sites the download is redirected to that send no CORS headers, as match patterns. Firefox
   * has to be allowed to reach them too. Hugging Face needs none.
   */
  alsoAllow?: readonly string[];
}

/** A file in a Hugging Face repository, at one commit (never a branch). */
const huggingFace = (repo: string, revision: string, file = "onnx/model.onnx") => ({
  source: `https://huggingface.co/${repo}`,
  url: `https://huggingface.co/${repo}/resolve/${revision}/${file}`,
});

/** Ships inside the add-on (public/assets/model.onnx, fetched by scripts/fetch-assets.ts). Never downloaded. */
export const BUNDLED: Model = {
  id: "tiny-voca",
  name: "tiny-voca",
  author: "Muhammed Nazeem",
  language: "en",
  frontend: "dizione",
  voices: ["F2", "M2"],
  licence: "Apache-2.0",
  ...huggingFace("n4ze3m/tiny-voca", "1e73262226dbf4ef02e9df277e81aaa1db5ce16c"),
  size: 21_386_372,
  sha256: "fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46",
};

/**
 * The end-to-end tests make a build of their own with one more entry, a stand-in served by the
 * local test site (tests/e2e/models.test.ts). In every other build this is undefined.
 */
const standIn: string | undefined = import.meta.env?.VITE_E2E_MODEL;

export const MODELS: readonly Model[] = [
  BUNDLED,
  {
    id: "sobbie",
    name: "SobbieTTS",
    author: "PatnaikAshish",
    language: "en",
    frontend: "dizione",
    voices: ["F", "M"],
    licence: "Apache-2.0",
    ...huggingFace("PatnaikAshish/SobbieTTS", "6b6132c6d34b5fc163d8f5553580678a60532ac3"),
    size: 21_386_372,
    sha256: "eafb38b736c17872091c0f05de87814257925a9c3c5aeff168c74afc496d9317",
  },
  {
    id: "fiato",
    name: "fiato",
    author: "cfahlgren1",
    language: "en",
    frontend: "dizione",
    voices: ["F1", "M1"],
    licence: "Apache-2.0",
    ...huggingFace("cfahlgren1/fiato", "967de50b6a9ab673ef7de9f8f276fa93a8c0db81"),
    size: 21_388_682,
    sha256: "179df2e1ede3935d4f928c0757947b25eb1f678ff347aef90e2efdf7ffb0048c",
  },
  {
    id: "tiny-voca-ptbr",
    name: "tiny-voca-ptbr",
    author: "SemFence (Gustavo Toledo)",
    language: "pt-BR",
    frontend: "dizione-ptbr",
    voices: ["F_s4", "M_sm4"],
    licence: "CC-BY-4.0",
    ...huggingFace("semfence/tiny-voca-ptbr", "f231cbe318c9f972e27fd8dad5d8ebcfb40a672f"),
    size: 21_370_200,
    sha256: "0ac1ffc83e508973513182ed79d4626556e35bcffcccd99ee066dde6d2c77e5b",
  },
  {
    id: "vocina",
    name: "vocina",
    author: "OfficinePixel",
    language: "it",
    frontend: "g2p-it",
    voices: ["I1", "I2"],
    licence: "Apache-2.0",
    source: "https://github.com/OfficinePixel/vocina",
    // A release tag can be moved; the SHA-256 below cannot.
    url: "https://github.com/OfficinePixel/vocina/releases/download/v1.0/vocina.onnx",
    size: 21_371_740,
    sha256: "4de67fb83f475a556d3dd4bfc748be909cf6936d317ff7a17ac935f8da8e9cc6",
    alsoAllow: ["https://release-assets.githubusercontent.com/*"],
  },
  {
    id: "tiny-voca-es",
    name: "tiny-voca-es",
    author: "marcosmaceo",
    language: "es-ES",
    frontend: "espeak-es",
    voices: ["F2", "M2"],
    licence: "Apache-2.0",
    ...huggingFace("marcosmaceo/tiny-voca-es", "9898eaef9b245d7a5240156eed919ee1bd2a9b84", "tiny-voca-es.onnx"),
    size: 21_383_998,
    sha256: "b4a9ca3becb9c7e6138c96ca8f7dceae760ccccf9305fbea9a6990667ff23a6c",
  },
  {
    id: "tiny-voca-fr",
    name: "tiny-voca-fr",
    author: "DanielSuncost",
    language: "fr",
    frontend: "espeak-fr",
    voices: ["FR_F1", "FR_M1"],
    licence: "Apache-2.0",
    ...huggingFace("DanielSuncost/tiny-voca-fr", "73f7700f514e70eef3b459aedcc49829d41945d4"),
    size: 21_368_019,
    sha256: "698249cf63768ecd6011d9ddc4137ed16b4d2856a3bc3ba1ab7e1e4e153fc727",
  },
  {
    id: "apptor-de",
    name: "apptor-tiny-tts",
    author: "apptor",
    language: "de",
    frontend: "g2p-de",
    voices: ["F2", "M2"],
    licence: "Apache-2.0",
    ...huggingFace("apptor/apptor-tiny-tts", "0b6962273a1d6618f250cdbd621b56ba04b62cef", "apptor-tiny-tts-de.onnx"),
    size: 21_379_442,
    sha256: "594d7536b0138957167bd2a6c9e1ca0301f726e981cab14296799444abdb5e46",
    helper: {
      url: "https://huggingface.co/apptor/apptor-tiny-tts/resolve/0b6962273a1d6618f250cdbd621b56ba04b62cef/apptor-g2p-de.onnx",
      size: 12_364_141,
      sha256: "d981694e7a03030b2169be46b2094775dde4ec5a3e9406c92a3fc8f1ed8bbec3",
    },
  },
  {
    id: "zerre-tts",
    name: "zerre-tts",
    author: "erkint",
    language: "tr",
    frontend: "espeak-tr",
    voices: ["MK", "NK"],
    licence: "Apache-2.0",
    ...huggingFace("erkint/zerre-tts", "55753a04ae624998cba86f7c17625616e318124e"),
    size: 21_381_286,
    sha256: "f4474434eb5c60e1f985afdf4251ddbc783384041aa09604257895783067cfca",
  },
  {
    id: "tiny-swara",
    name: "tiny-swara",
    author: "Xeven7",
    language: "bn",
    frontend: "espeak-bn",
    voices: ["BF", "BM"],
    licence: "Apache-2.0",
    ...huggingFace("Xeven7/tiny-swara", "9432a340c46249c8acae4ff4b062d46b9cbd1991", "onnx/tiny-swara.onnx"),
    size: 21_387_142,
    sha256: "cef829cff4b6cb38554e32d8f96b9b51f96a4c0e9cb2e406b53ac79d5923d630",
  },
  {
    id: "tui-voice-ml",
    name: "tui-voice-mini-ml",
    author: "Cyrax321",
    language: "ml",
    frontend: "espeak-ml",
    // The model has a second voice slot, but its makers name data for this one only.
    voices: ["F2"],
    licence: "Apache-2.0",
    ...huggingFace(
      "Cyrax321/tui-voice-mini-ml",
      "9c2fee75373d81bbd62fbe2d683b1bad3c4415ea",
      "onnx/tui-voice-mini-ml.onnx",
    ),
    size: 21_386_372,
    sha256: "3fddc5a894eb1dd501921c6342cbbf350d56bbd08a55bf9e2a5a7ac614f355b5",
    // Their own defaults, "to keep the voice female".
    tuning: { pitchShift: 0.15, pitchRange: 0.85 },
  },
  ...(standIn ? [JSON.parse(standIn) as Model] : []),
];

/** "English", "Brazilian Portuguese": a model's language, named in English. */
export const languageName = (model: Model): string =>
  new Intl.DisplayNames(["en"], { type: "language" }).of(model.language) ?? model.language;

/** "tiny-voca only reads English": said where text in another language or script turns up. */
export const readsOnly = (model: Model): string => `${model.name} only reads ${languageName(model)}`;

export const modelById = (id: unknown): Model | undefined => MODELS.find((model) => model.id === id);

/** Why a model could not be downloaded or used. The message is for the user. */
export class ModelError extends Error {}

/** Where a model's helper file is kept in storage, beside the model under its id. */
export const helperKey = (id: string) => `${id}/helper`;

/** Throws unless `bytes` is exactly the file the list pins. */
export async function verifyModel(bytes: Uint8Array<ArrayBuffer>, model: PinnedFile) {
  if (bytes.length !== model.size)
    throw new ModelError(`The download is ${bytes.length} bytes long, not the ${model.size} expected.`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== model.sha256) throw new ModelError("The download is not the file Tiny Reader expects.");
}

/**
 * Downloads a file of a model and resolves to it only once it has been verified. Nothing is sent
 * but the request itself: no cookies, no body. `onProgress` is told the bytes received so far.
 * The caller holds the host permission for the site, so that Firefox adds no Origin header.
 */
export async function downloadModel(
  model: PinnedFile,
  onProgress: (received: number) => void = () => {},
  signal?: AbortSignal,
  get: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const host = new URL(model.url).hostname;
  const response = await get(model.url, { credentials: "omit", signal }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new ModelError(`Tiny Reader could not reach ${host}.`);
  });
  if (!response.ok || !response.body) throw new ModelError(`${host} answered with error ${response.status}.`);
  // Never more than the size expected, whatever the server sends.
  const bytes = new Uint8Array(model.size);
  let received = 0;
  const reader = response.body.getReader();
  const next = () =>
    reader.read().catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new ModelError(`The download from ${host} broke off.`);
    });
  for (let chunk = await next(); !chunk.done; chunk = await next()) {
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
