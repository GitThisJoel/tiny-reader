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
const HF =
	"https://huggingface.co/n4ze3m/tiny-voca/resolve/1e73262226dbf4ef02e9df277e81aaa1db5ce16c";
const GH =
	"https://raw.githubusercontent.com/n4ze3m/tiny-voca/0eea2be213b53ec0b1949c169b80e611544718e1";

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

export const ASSETS: Asset[] = [
	// Shipped in the add-on (WXT copies public/ into the build). The first two hashes are the
	// ones Hugging Face publishes for the LFS objects; the rest were computed at the pinned
	// revision, because Hugging Face publishes none for small files.
	hf(
		"onnx/model.onnx",
		"public/assets/model.onnx",
		"fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46",
	),
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
	hf(
		"config.json",
		"vendor/tiny-voca/config.json",
		"27bcbf322fc428581f0e959be1c141dd7751c61f4fed5eded326e779b215f69c",
	),
	// Upstream's JS port of the dizione phonemizer, plus the GGUF reader in tiny-voca.js.
	js(
		"tiny-voca.js",
		"a5d3df367d6af3e97efa837869c2f15d9605e92938f8d7e3a85b6eb4bdb32e8f",
	),
	js(
		"dizione/align.js",
		"39128059420f44c7a19dc1d3d6f5b63361c4694a2a4a9bed986f7885cf291663",
	),
	js(
		"dizione/convert.js",
		"6d6c98f082c199286ccb2bb694f065d7aada31e26c7e042a9690f8517628a80c",
	),
	js(
		"dizione/engine.js",
		"8ddeabd63909662fe7d7d466e2572a5aada3fcb3eb747438f3c0a0204ab0be16",
	),
	js(
		"dizione/g2p.js",
		"099a0d340c6996872a79feb857ad314a96b89311ec99c697de691bbfa4d9736e",
	),
	js(
		"dizione/homographs.js",
		"81912c2d0fd22cb2f3a81bdf0ed3e7d41df424b4ecc6729e5967ec4169e56bfd",
	),
	js(
		"dizione/lexicon.js",
		"0dc926540098beb51cb894b1c4b6717e7dcd65a6a8aab11d5ce70e020314f344",
	),
	js(
		"dizione/morphology.js",
		"012934dee4c85e902b72e6f8f76c1e78e7531a1050177a3092a42f2117ee7462",
	),
	js(
		"dizione/normalize.js",
		"ed448256a3cb2f6cc8b2ab026d185678f72050ae9c30e5b013b113ffc2aba45a",
	),
	js(
		"dizione/pyre.js",
		"586a8d60f7df8efd2259f78d02ab428aaec072e93d66e0cd88a68af77992b3d7",
	),
	js(
		"dizione/sentence.js",
		"aec4bc6114bc888b99f0d09901ce08613935b9e92202e151898727c606b2e02c",
	),
	js(
		"dizione/symbols.js",
		"85a45593e4519295262f44ca88fbcb4790c9f992267f90f9cbddfb2776c66dc6",
	),
	js(
		"dizione/tables.js",
		"4d4aa615e86ed234df0187a059b36bb9c933f769774af5b426670020b8c2a624",
	),
];

export const sha256 = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** Fetches one asset unless a verified copy is already on disk. Throws on a hash mismatch. */
export async function fetchAsset(
	asset: Asset,
	root = ROOT,
	get: typeof fetch = fetch,
) {
	const target = join(root, asset.path);
	const existing = await readFile(target).catch(() => null);
	if (existing && sha256(existing) === asset.sha256) return "cached";
	const response = await get(asset.url);
	if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const actual = sha256(bytes);
	if (process.env.UPDATE_HASHES) console.log(`${actual}  ${asset.path}`);
	else if (actual !== asset.sha256)
		throw new Error(
			`${asset.path}: SHA-256 is ${actual}, expected ${asset.sha256}`,
		);
	await mkdir(dirname(target), { recursive: true });
	// Write then rename, so an interrupted download never leaves a half file at the real path.
	await writeFile(`${target}.part`, bytes);
	await rename(`${target}.part`, target);
	return "downloaded";
}

if (import.meta.main) {
	for (const asset of ASSETS)
		console.log(`${await fetchAsset(asset)}  ${asset.path}`);
}
