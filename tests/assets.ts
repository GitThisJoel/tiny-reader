import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFrontEnd } from "../engine/frontends.ts";
import { downloadModel, type PinnedFile, verifyModel } from "../engine/models.ts";
import { loadPhonemizer, type Phonemes } from "../engine/phonemizer.ts";

const ROOT = join(import.meta.dirname, "..");
const read = async (path: string) => {
  const bytes = await readFile(join(ROOT, path)).catch(() => {
    throw new Error(`${path} is missing: run \`pnpm fetch-assets\` first`);
  });
  return new Uint8Array(bytes);
};

export const readModel = () => read("public/assets/model.onnx");
export const readGguf = async () => (await read("public/assets/tiny-voca-js.gguf")).buffer;
export const readConfig = async () => JSON.parse(new TextDecoder().decode(await read("vendor/tiny-voca/config.json")));
export const testPhonemizer = async () => loadPhonemizer(await readGguf());

/** Reads a file of the add-on package from `public/`, as the engine Worker fetches it. */
export const readAsset = async (path: string) => (await read(`public${path}`)).buffer;

/** A front end that answers at once: every one but the German, which runs a model of its own. */
export type SyncFrontEnd = (text: string) => Phonemes | null;
export const loadSyncFrontEnd = async (name: string) => (await loadFrontEnd(name, readAsset)) as SyncFrontEnd;

/**
 * A file the add-on downloads (a model, or its helper), from `.cache/models/` or downloaded from
 * its pinned address and verified first.
 */
export async function cached(file: PinnedFile, name: string) {
  const path = join(ROOT, ".cache/models", name);
  const kept = await readFile(path).catch(() => null);
  if (kept) {
    const bytes = new Uint8Array(kept);
    await verifyModel(bytes, file);
    return bytes;
  }
  const bytes = await downloadModel(file);
  await mkdir(join(ROOT, ".cache/models"), { recursive: true });
  await writeFile(path, bytes);
  return bytes;
}
