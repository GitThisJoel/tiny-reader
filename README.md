# tiny-reader

A Firefox add-on (Manifest V3) that reads web page text aloud with the
[tiny-voca](https://github.com/n4ze3m/tiny-voca) text-to-speech model and highlights what is
being spoken. Inference runs locally in the browser through ONNX Runtime Web. No text or audio
leaves the machine, and the add-on makes no network requests at runtime.

**Status:** Milestone 1 of 7 (repository scaffold and infrastructure). The add-on builds and
loads but does not read anything yet. Research behind the design is in
[docs/FINDINGS.md](docs/FINDINGS.md).

## Requirements

- Node.js 22.18 or newer
- [pnpm](https://pnpm.io/installation) 12 (the exact version is pinned in `package.json`)
- Firefox 140 or newer, desktop

## Setup

```bash
pnpm install
pnpm fetch-assets
```

`pnpm fetch-assets` downloads the model, the phonemizer data and upstream's JavaScript
phonemizer (about 30 MB) into `public/assets/` and `vendor/`. Every file is pinned to a commit
and checked against a SHA-256 in [scripts/fetch-assets.ts](scripts/fetch-assets.ts). These files
are never committed. Running it again only re-verifies what is on disk.

## Development

```bash
pnpm dev
```

Builds in watch mode and starts Firefox with the add-on installed in a temporary profile.

If Firefox is installed as a snap, `web-ext` cannot reach it. Create `web-ext.config.ts`
(gitignored) pointing at the real binary:

```ts
import { defineWebExtConfig } from "wxt";

export default defineWebExtConfig({
	binaries: { firefox: "/snap/firefox/current/usr/lib/firefox/firefox" },
});
```

## Scripts

| Command             | What it does                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`          | Watch build and launch Firefox with the add-on                                            |
| `pnpm build`        | Production build into `.output/firefox-mv3/`                                              |
| `pnpm zip`          | Build and package `.output/tiny-reader-<version>-firefox.zip`, plus a sources zip for AMO |
| `pnpm lint`         | Biome lint and format check                                                               |
| `pnpm format`       | Biome, applying fixes                                                                     |
| `pnpm typecheck`    | `tsc --noEmit` in strict mode                                                             |
| `pnpm test`         | Vitest unit tests                                                                         |
| `pnpm lint:ext`     | `web-ext lint` on the build (run `pnpm build` first)                                      |
| `pnpm fetch-assets` | Download and verify model and phonemizer assets                                           |

`pnpm lint:ext` reports one accepted warning about Firefox for Android; the add-on is desktop
only. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of the above and uploads
the zip as an artifact.

## Architecture

Planned; each part lands in its own milestone.

```
page (content script)                background event page            engine Worker
---------------------                ---------------------            -------------
selection, Intl.Segmenter   Port     context menu, commands   post    normalise → phonemise
text offset → DOM Range   <------->  message routing        <------>  → ONNX Runtime Web (wasm)
CSS Custom Highlight API             owns the Worker        Message   returns PCM + durations
Web Audio queue, control bar
```

- **Content script**: captures the selection, splits it into sentences, maps text offsets back
  to DOM ranges, highlights through the CSS Custom Highlight API (no page DOM changes), plays
  audio with Web Audio and a prefetch queue, and shows a control bar inside a shadow root.
- **Background event page**: context menu, keyboard commands, and routing between content
  scripts and the engine. It owns the engine Worker, because a content script cannot start an
  extension Worker (FINDINGS §7).
- **Engine Worker**: phonemiser and ONNX Runtime Web (single-threaded wasm). It stays loaded
  while a page is reading and is unloaded by Firefox 30 seconds after reading stops.

## Permissions

None yet. Each permission will be listed here with its reason when the milestone that needs it
adds it. The extension CSP is `script-src 'self' 'wasm-unsafe-eval'`: wasm compilation is
required by ONNX Runtime, and nothing else is allowed.

## Before publishing

The add-on ID in [wxt.config.ts](wxt.config.ts) (`tiny-reader@tiny-reader.invalid`) is a
placeholder. Change it before submitting to addons.mozilla.org.

## Third-party components

- tiny-voca model and JavaScript phonemizer: Apache-2.0, © Muhammed Nazeem
- Phonemizer dictionary: derived from the CMU Pronouncing Dictionary (BSD-style licence)

The licence texts are bundled in the add-on under `assets/licenses/`.
