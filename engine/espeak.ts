// eSpeak NG 1.52.0, compiled to WebAssembly by scripts/build-espeak.sh: text to phonemes for
// the models that were trained on its output. Adapted from site/espeak/espeak.js in
// https://github.com/stdevMac/tiny-voca (Apache-2.0). eSpeak NG itself is GPL-3.0-or-later.
import createEspeakCore from "espeak/espeak-ng-core.mjs";

const DATA_DIR = "/espeak-ng-data";

/** The data pack: "TVPK" | u32le n | JSON [[path, size], ...] (n bytes) | file bytes, gzipped. */
async function unpack(packed: ArrayBuffer): Promise<[path: string, data: Uint8Array][]> {
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "TVPK") throw new Error("espeak: bad data pack");
  const headerLength = new DataView(bytes.buffer).getUint32(4, true);
  const index: [string, number][] = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
  let offset = 8 + headerLength;
  const files = index.map(([path, size]): [string, Uint8Array] => {
    const data = bytes.subarray(offset, offset + size);
    offset += size;
    return [path, data];
  });
  // A pack cut short, or one whose list is not its own, would give eSpeak NG files that end early.
  if (offset !== bytes.length) throw new Error("espeak: bad data pack");
  return files;
}

type Read = (path: string) => Promise<ArrayBuffer>;
type Core = Awaited<ReturnType<typeof createEspeakCore>>;

/** Calls `use` with `text` as a C string. */
function withString(core: Core, text: string, use: (pointer: number) => number) {
  const size = core.lengthBytesUTF8(text) + 1;
  const pointer = core._malloc(size);
  core.stringToUTF8(text, pointer, size);
  try {
    return use(pointer);
  } finally {
    core._free(pointer);
  }
}

async function start(read: Read): Promise<Core> {
  const [wasmBinary, pack] = await Promise.all([
    read("/assets/espeak/espeak-ng-core.wasm"),
    read("/assets/espeak/espeak-ng-data.pack").then(unpack),
  ]);
  // What eSpeak NG says while it starts, for the error. Later it complains about every word of a
  // script whose dictionary is not packed, which nobody reads.
  let said: string[] | null = [];
  const core = await createEspeakCore({
    wasmBinary,
    noInitialRun: true,
    print: () => {},
    printErr: (line) => void said?.push(line),
  });
  for (const [path, data] of pack) {
    const full = `${DATA_DIR}/${path}`;
    core.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    core.FS.writeFile(full, data);
  }
  const status = withString(core, DATA_DIR, (path) => core._tr_init(path));
  if (status !== 0) throw new Error(`espeak: could not start (status ${status}) ${said.join(" ")}`);
  said = null;
  return core;
}

// One eSpeak NG for every voice: a second one would hold the wasm heap and the unpacked data a second time.
let shared: Promise<Core> | undefined;
/** The voice it speaks with now. */
let speaking = "";
function core(read: Read) {
  if (!shared) {
    shared = start(read);
    // Tried again by the next model that needs it.
    shared.catch(() => {
      shared = undefined;
    });
  }
  return shared;
}

/** The version the wasm build reports, as `espeak-ng --version` would. */
export const espeakVersion = async (read: Read) => {
  const espeak = await core(read);
  return espeak.UTF8ToString(espeak._tr_version());
};

/**
 * Sets eSpeak NG up for one voice ("es", "fr-fr"). The function it resolves to returns, for a
 * piece of text, exactly what `espeak-ng -q --ipa --sep=_ -v <voice> --stdin` prints: IPA with
 * "_" between phonemes and a space between words.
 */
export async function loadEspeak(read: Read, voice: string): Promise<(text: string) => string> {
  const espeak = await core(read);
  /** Makes `voice` the one that speaks, when another one spoke last. */
  function choose() {
    if (speaking === voice) return;
    const status = withString(espeak, voice, (name) => espeak._tr_voice(name));
    speaking = status === 0 ? voice : "";
    if (status !== 0) throw new Error(`espeak: no voice "${voice}" (status ${status})`);
  }
  choose(); // a voice the data pack lacks is refused now, not at the first sentence

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (text) => {
    choose();
    // The bytes the program would read from standard input.
    const input = encoder.encode(`${text}\n`);
    const inputPointer = espeak._malloc(input.length + 1);
    const lengthPointer = espeak._malloc(4);
    try {
      espeak.HEAPU8.set(input, inputPointer);
      const output = espeak._tr_phonemize(inputPointer, input.length, lengthPointer);
      // eSpeak NG reported an error, or memory ran out: not the same as nothing to say.
      if (!output) throw new Error("espeak: could not phonemize");
      const length = espeak.HEAP32[lengthPointer >> 2] ?? 0;
      const said = decoder.decode(espeak.HEAPU8.slice(output, output + length));
      espeak._free(output);
      return said;
    } finally {
      espeak._free(inputPointer);
      espeak._free(lengthPointer);
    }
  };
}
