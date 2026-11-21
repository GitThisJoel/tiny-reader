import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSETS, type Asset, fetchAsset, sha256 } from "./fetch-assets.ts";

const bytes = new TextEncoder().encode("hello");
const asset: Asset = {
  url: "https://example.invalid/a",
  path: "a/b.bin",
  sha256: sha256(bytes),
};
const serve = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
const never = (async () => {
  throw new Error("network used");
}) as typeof fetch;

describe("fetch-assets", () => {
  it("pins every asset to a commit, or to a release tag, and a SHA-256", () => {
    for (const { url, sha256 } of ASSETS) {
      expect(url).toMatch(/\/[0-9a-f]{40}\/|\/releases\/download\/v[\d.]+\//);
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(ASSETS.map((a) => a.path)).size).toBe(ASSETS.length);
  });

  it("downloads, verifies, then reuses the verified copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-"));
    expect(await fetchAsset(asset, root, serve("hello"))).toBe("downloaded");
    expect(await readFile(join(root, asset.path))).toEqual(Buffer.from(bytes));
    expect(await fetchAsset(asset, root, never)).toBe("cached");
  });

  it("rejects a download with the wrong hash and keeps nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-"));
    await expect(fetchAsset(asset, root, serve("evil"))).rejects.toThrow(/SHA-256/);
    await expect(readFile(join(root, asset.path))).rejects.toThrow();
  });

  it("replaces a corrupted file on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-"));
    await fetchAsset(asset, root, serve("hello"));
    await writeFile(join(root, asset.path), "corrupt");
    expect(await fetchAsset(asset, root, serve("hello"))).toBe("downloaded");
  });

  it("fails on an HTTP error", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-"));
    await expect(fetchAsset(asset, root, serve("hello", 404))).rejects.toThrow(/HTTP 404/);
  });
});
