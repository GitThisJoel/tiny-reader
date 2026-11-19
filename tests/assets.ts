import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPhonemizer } from "../engine/phonemizer.ts";

const ROOT = join(import.meta.dirname, "..");
const read = async (path: string) => {
	const bytes = await readFile(join(ROOT, path)).catch(() => {
		throw new Error(`${path} is missing: run \`pnpm fetch-assets\` first`);
	});
	return new Uint8Array(bytes);
};

export const readModel = () => read("public/assets/model.onnx");
export const readGguf = async () =>
	(await read("public/assets/tiny-voca-js.gguf")).buffer;
export const readConfig = async () =>
	JSON.parse(
		new TextDecoder().decode(await read("vendor/tiny-voca/config.json")),
	);
export const testPhonemizer = async () => loadPhonemizer(await readGguf());
