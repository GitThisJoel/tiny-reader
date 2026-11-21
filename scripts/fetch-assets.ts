// Downloads the model, the phonemizer data and upstream's JS phonemizer at pinned revisions and
// verifies every file against a pinned SHA-256. Nothing here is committed to the repository.
//
//   pnpm fetch-assets
//
// To bump a revision: change the commit below, run with UPDATE_HASHES=1 to print the new
// hashes, review the upstream diff, paste them in, and regenerate the parity fixtures.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const HF = "https://huggingface.co/n4ze3m/tiny-voca/resolve/1e73262226dbf4ef02e9df277e81aaa1db5ce16c";
const GH = "https://raw.githubusercontent.com/n4ze3m/tiny-voca/0eea2be213b53ec0b1949c169b80e611544718e1";
// Text front ends for other languages: code that must ship in the add-on, and its data.
const PTBR = "https://raw.githubusercontent.com/SemFence/dizione-ptbr-js/8fbb77e579fe684f3afd9cb2a801d0adce8c89cf";
const VOCINA = "https://raw.githubusercontent.com/OfficinePixel/vocina/8dd17b31b0b6e40ce132105f5d0ea9eb7da98f34";
// Front ends that work from eSpeak NG's output. eSpeak NG itself is built by scripts/build-espeak.sh.
const SPANISH = "https://raw.githubusercontent.com/stdevMac/tiny-voca/a4bf2bd979fc40b1bd7e34e13c0164db627d14ec";
const FRENCH = "https://raw.githubusercontent.com/DanielSuncost/tiny-voca-fr/4cc26ab23d934e3d33796eb06bf11f23f4c9ab34";

export interface Asset {
  url: string;
  /** Destination, relative to the repository root. */
  path: string;
  sha256: string;
}

const hf = (file: string, path: string, sha256: string): Asset => ({
  url: `${HF}/${file}`,
  path,
  sha256,
});
const js = (file: string, sha256: string): Asset => ({
  url: `${GH}/js/${file}`,
  path: `vendor/tiny-voca/js/${file}`,
  sha256,
});

const from = (base: string, file: string, path: string, sha256: string): Asset => ({
  url: `${base}/${file}`,
  path,
  sha256,
});

export const ASSETS: Asset[] = [
  // Shipped in the add-on (WXT copies public/ into the build). The first two hashes are the
  // ones Hugging Face publishes for the LFS objects; the rest were computed at the pinned
  // revision, because Hugging Face publishes none for small files.
  hf("onnx/model.onnx", "public/assets/model.onnx", "fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46"),
  hf(
    "gguf/tiny-voca-js.gguf",
    "public/assets/tiny-voca-js.gguf",
    "8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653",
  ),
  hf(
    "LICENSE",
    "public/assets/licenses/tiny-voca.LICENSE.txt",
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  ),
  hf(
    "phonemizer/LICENSE.cmudict",
    "public/assets/licenses/cmudict.LICENSE.txt",
    "bd4ce8e44170a5f9f481310ca85c51de3c4f851a65e679b40e603b143bd3542a",
  ),
  hf(
    "phonemizer/LICENSE.homograph-data",
    "public/assets/licenses/homograph-data.LICENSE.txt",
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  ),
  // Build- and test-time only.
  hf("config.json", "vendor/tiny-voca/config.json", "27bcbf322fc428581f0e959be1c141dd7751c61f4fed5eded326e779b215f69c"),
  // Upstream's JS port of the dizione phonemizer, plus the GGUF reader in tiny-voca.js.
  js("tiny-voca.js", "a5d3df367d6af3e97efa837869c2f15d9605e92938f8d7e3a85b6eb4bdb32e8f"),
  js("dizione/align.js", "39128059420f44c7a19dc1d3d6f5b63361c4694a2a4a9bed986f7885cf291663"),
  js("dizione/convert.js", "6d6c98f082c199286ccb2bb694f065d7aada31e26c7e042a9690f8517628a80c"),
  js("dizione/engine.js", "8ddeabd63909662fe7d7d466e2572a5aada3fcb3eb747438f3c0a0204ab0be16"),
  js("dizione/g2p.js", "099a0d340c6996872a79feb857ad314a96b89311ec99c697de691bbfa4d9736e"),
  js("dizione/homographs.js", "81912c2d0fd22cb2f3a81bdf0ed3e7d41df424b4ecc6729e5967ec4169e56bfd"),
  js("dizione/lexicon.js", "0dc926540098beb51cb894b1c4b6717e7dcd65a6a8aab11d5ce70e020314f344"),
  js("dizione/morphology.js", "012934dee4c85e902b72e6f8f76c1e78e7531a1050177a3092a42f2117ee7462"),
  js("dizione/normalize.js", "ed448256a3cb2f6cc8b2ab026d185678f72050ae9c30e5b013b113ffc2aba45a"),
  js("dizione/pyre.js", "586a8d60f7df8efd2259f78d02ab428aaec072e93d66e0cd88a68af77992b3d7"),
  js("dizione/sentence.js", "aec4bc6114bc888b99f0d09901ce08613935b9e92202e151898727c606b2e02c"),
  js("dizione/symbols.js", "85a45593e4519295262f44ca88fbcb4790c9f992267f90f9cbddfb2776c66dc6"),
  js("dizione/tables.js", "4d4aa615e86ed234df0187a059b36bb9c933f769774af5b426670020b8c2a624"),
  // Brazilian Portuguese: dizione-ptbr in TypeScript (Apache-2.0) and its lexicon (CC BY 4.0).
  from(
    PTBR,
    "src/engine.ts",
    "vendor/dizione-ptbr/src/engine.ts",
    "6424ce6eeb215f90dc7835f37c251aff225a97be8fbe3e1ef5f4a7540d55d9cd",
  ),
  from(
    PTBR,
    "src/g2p.ts",
    "vendor/dizione-ptbr/src/g2p.ts",
    "83fed6dc7414a158b96f323c0be3d6f0cdfa4b838eac35728df431f9f1f9c295",
  ),
  from(
    PTBR,
    "src/normalize.ts",
    "vendor/dizione-ptbr/src/normalize.ts",
    "bcb8b91b5ee3e3232b41387141bc5cbb1a5de01b05f2da359cb7482042444f93",
  ),
  from(
    PTBR,
    "src/symbols.ts",
    "vendor/dizione-ptbr/src/symbols.ts",
    "5189a73aabf3b860fdb9fb89581f701177be771fcca3bfc422a300bdb158d19e",
  ),
  from(
    PTBR,
    "data/lexicon.tsv",
    "public/assets/dizione-ptbr/lexicon.tsv",
    "0bc25b54898d67c07a73567f4bff5438480a24256388b02c6fa8b7c4c8408e80",
  ),
  from(
    PTBR,
    "data/open_table.json",
    "public/assets/dizione-ptbr/open_table.json",
    "a0e71c7d2f4e59c7affa1aebb5241c574f9c7ec0282e81326397a54da46bd9cb",
  ),
  from(
    PTBR,
    "NOTICE",
    "public/assets/licenses/dizione-ptbr.NOTICE.txt",
    "deb714a8b5cb980aac2b88415fc8e49b75d65bc89b3f3f58466872b59a2fd491",
  ),
  from(
    PTBR,
    "data/LICENSE.mfa-dictionary.md",
    "public/assets/licenses/dizione-ptbr-lexicon.LICENSE.md",
    "dc781911ac85edede519a742e56c104199f2b6027ce51b77304e61b1a3ad2517",
  ),
  from(
    PTBR,
    "test/golden.sample.json",
    "vendor/dizione-ptbr/test/golden.sample.json",
    "2519484848ad029cccfc2f9d3149f8ca478908210907cc15d1cb06a2cc294ebc",
  ), // tests only
  // Italian: vocina's own converter (Apache-2.0), its data, and its Wiktionary lexicon (CC BY-SA 4.0).
  from(
    VOCINA,
    "g2p_it/g2p_it.js",
    "vendor/vocina/g2p_it.js",
    "9a0a5bdd9feddd45d1ed32db2cad2a431a7b3f70b0f5a33bd45d24e934b4c825",
  ),
  from(
    VOCINA,
    "g2p_it/dati.json",
    "public/assets/g2p-it/dati.json",
    "a55faf08a98001f62db30780f593a2bd00cb9acf4cb6fb73a9bd06a4723d0ced",
  ),
  from(
    VOCINA,
    "g2p_it/lessico_wikizionario.json",
    "public/assets/g2p-it/lessico_wikizionario.json",
    "2ac11cdd7d6ad2b001d1719e504f80807cb0b517ab506154744111257d987f39",
  ),
  from(
    VOCINA,
    "NOTICE",
    "public/assets/licenses/vocina.NOTICE.txt",
    "2c3a05a6d628550a27875dad22463ceedfab25e547cd3740d40dc7c195565520",
  ),
  from(
    VOCINA,
    "g2p_it/vettori.json",
    "vendor/vocina/vettori.json",
    "72a09515c2d6ce3cefabc58a887f740725f2d124317d28b714cfa46290be972c",
  ), // tests only
  // Spanish and French: each model's own JavaScript front end (Apache-2.0), fed by eSpeak NG.
  from(
    SPANISH,
    "site/frontend.js",
    "vendor/tiny-voca-es/frontend.js",
    "ba9b1ff1608e096d91c8ad2eee39e70a00559f629c29a945a4d01989c4b34c0a",
  ),
  from(
    FRENCH,
    "web/public/frontend-fr.js",
    "vendor/tiny-voca-fr/frontend-fr.js",
    "fb429d3e1fabc9dc1256427dbf8c9a0c597c1e61779bf5217134bfc2f860bf02",
  ),
  // Each model's own description, to test that its symbol table is its front end's.
  from(
    "https://huggingface.co/semfence/tiny-voca-ptbr/resolve/f231cbe318c9f972e27fd8dad5d8ebcfb40a672f",
    "onnx/model.json",
    "vendor/dizione-ptbr/test/model.json",
    "0cef74c03aa5b4d705c8ea9810ec71b053da9b33a40925dbdf880ed471120060",
  ),
  from(
    "https://huggingface.co/marcosmaceo/tiny-voca-es/resolve/9898eaef9b245d7a5240156eed919ee1bd2a9b84",
    "tiny-voca-es.json",
    "vendor/tiny-voca-es/model.json",
    "bec46d85ccf80f746f7052c8532c9e74d04c00763831620c47f5442b52afc05f",
  ),
  from(
    "https://huggingface.co/DanielSuncost/tiny-voca-fr/resolve/73f7700f514e70eef3b459aedcc49829d41945d4",
    "onnx/model.json",
    "vendor/tiny-voca-fr/model.json",
    "b36144a5aeefc07a1ed94d40d20f9bf8514d962236ffd3dee39f0be8a6d9c459",
  ),
  from(
    "https://github.com/OfficinePixel/vocina/releases/download/v1.0",
    "vocina.json",
    "vendor/vocina/model.json",
    "2f07dbe350d2fdc891126d4847fe251e7ab48d04c3d87836123030d5a3e1a3f8",
  ),
];

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Fetches one asset unless a verified copy is already on disk. Throws on a hash mismatch. */
export async function fetchAsset(asset: Asset, root = ROOT, get: typeof fetch = fetch) {
  const target = join(root, asset.path);
  const existing = await readFile(target).catch(() => null);
  if (existing && sha256(existing) === asset.sha256) return "cached";
  const response = await get(asset.url);
  if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (process.env.UPDATE_HASHES) console.log(`${actual}  ${asset.path}`);
  else if (actual !== asset.sha256) throw new Error(`${asset.path}: SHA-256 is ${actual}, expected ${asset.sha256}`);
  await mkdir(dirname(target), { recursive: true });
  // Write then rename, so an interrupted download never leaves a half file at the real path.
  await writeFile(`${target}.part`, bytes);
  await rename(`${target}.part`, target);
  return "downloaded";
}

if (import.meta.main) {
  for (const asset of ASSETS) console.log(`${await fetchAsset(asset)}  ${asset.path}`);
}
