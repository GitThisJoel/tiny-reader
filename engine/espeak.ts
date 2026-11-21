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
  return index.map(([path, size]) => {
    const data = bytes.subarray(offset, offset + size);
    offset += size;
    return [path, data];
  });
}

/**
 * Sets eSpeak NG up for one voice ("es", "fr-fr"). The function it resolves to returns, for a
 * piece of text, exactly what `espeak-ng -q --ipa --sep=_ -v <voice> --stdin` prints: IPA with
 * "_" between phonemes and a space between words.
 */
export async function loadEspeak(
  read: (path: string) => Promise<ArrayBuffer>,
  voice: string,
): Promise<(text: string) => string> {
  const [wasmBinary, pack] = await Promise.all([
    read("/assets/espeak/espeak-ng-core.wasm"),
    read("/assets/espeak/espeak-ng-data.pack").then(unpack),
  ]);
  const errors: string[] = [];
  const core = await createEspeakCore({
    wasmBinary,
    noInitialRun: true,
    print: () => {},
    printErr: (line) => void errors.push(line),
  });
  for (const [path, data] of pack) {
    const full = `${DATA_DIR}/${path}`;
    core.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    core.FS.writeFile(full, data);
  }
  const withString = (text: string, use: (pointer: number) => number) => {
    const size = core.lengthBytesUTF8(text) + 1;
    const pointer = core._malloc(size);
    core.stringToUTF8(text, pointer, size);
    try {
      return use(pointer);
    } finally {
      core._free(pointer);
    }
  };
  const status = withString(DATA_DIR, (path) => withString(voice, (name) => core._tr_init(path, name)));
  if (status !== 0) throw new Error(`espeak: no voice "${voice}" (status ${status}) ${errors.join(" ")}`);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (text) => {
    // The bytes the program would read from standard input.
    const input = encoder.encode(`${text}\n`);
    const inputPointer = core._malloc(input.length + 1);
    const lengthPointer = core._malloc(4);
    try {
      core.HEAPU8.set(input, inputPointer);
      const output = core._tr_phonemize(inputPointer, input.length, lengthPointer);
      if (!output) throw new Error("espeak: no output");
      const length = core.HEAP32[lengthPointer >> 2] ?? 0;
      const said = decoder.decode(core.HEAPU8.slice(output, output + length));
      core._free(output);
      return said;
    } finally {
      core._free(inputPointer);
      core._free(lengthPointer);
    }
  };
}
