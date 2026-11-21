# Contributing

How to build, run and test Tiny Reader, and the conventions the repository follows. For how the parts fit together see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for what was measured and why things are the way they are see
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

Builds in watch mode and starts Firefox with the add-on installed in a temporary profile. It
opens the engine test page (`playground.html`), where you can type a sentence and hear it. To use a build in your
normal Firefox instead, see [Trying it](README.md#trying-it) in the README.

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
| `pnpm screenshots`  | Redraw the popup pictures in `docs/screenshots/` from the build (run `pnpm build` first)  |

`pnpm lint:ext` reports no errors and four accepted warnings:

- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: the add-on is desktop only.
- `UNSAFE_VAR_ASSIGNMENT` in the document page's script and in `pdf.worker.min-*.mjs`: both are pdf.js, bundled
  unmodified from the `pdfjs-dist` npm package.
- `UNSAFE_VAR_ASSIGNMENT` in `engine-worker.js`: ONNX Runtime loads its own wasm loader with a
  dynamic `import()`. The URL is always `ort/ort-wasm-simd-threaded.mjs` inside the add-on
  package, an unmodified file from the `onnxruntime-web` npm package.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs everything above except
`test:e2e` and uploads the zip as an artifact. The end-to-end tests are left out of CI because
they have only been run locally; set `FIREFOX` to the binary if it is not found.

## Pre-commit hook

[lefthook](https://lefthook.dev) installs a Git pre-commit hook when dependencies are installed (`pnpm install`).
It is configured in [lefthook.yml](lefthook.yml) and runs Biome (lint and formatting) on the staged files; a
finding stops the commit. Fix with `pnpm format`, stage again and commit. `git commit --no-verify` skips it once,
and `pnpm exec lefthook install` reinstalls the hook if it is ever missing.

## Commit messages

Commits use semantic commit messages: `type(scope): subject`, with the scope optional and the subject in the
imperative, lower case, on one line.

| Type                | For                                                  |
| ------------------- | ---------------------------------------------------- |
| `feat`              | A new capability of the add-on                       |
| `fix`               | A bug fix                                            |
| `test`              | Tests only                                           |
| `docs`              | Documentation only                                   |
| `ci`                | The GitHub Actions workflow and Dependabot config    |
| `build`             | Build tooling, asset fetching and dependency bumps   |
| `chore`             | Repository upkeep that fits none of the above        |
| `perf`              | A change that only makes something faster or lighter |
| `refactor`, `style` | Code changes with no change in behaviour; formatting |

Scopes in use: `engine`, `content`, `highlight`, `options`, `e2e`, `parity`, `assets`, `scripts`, `deps`, `dependabot`.
Examples: `feat(engine): align spoken words to source text`, `test(e2e): add reading tests on strict-CSP pages`,
`docs: document the pre-commit hook`.

## Phonemizer parity

Text is turned into phoneme ids by upstream's JavaScript port of the
[dizione](https://github.com/n4ze3m/dizione) phonemizer. `pnpm test:parity` checks that it gives
exactly the ids and stress values of the Python reference for every sentence in
[tests/parity/fixtures.json](tests/parity/fixtures.json).

To regenerate the fixtures (needs `git`, Python 3.10+ and `numpy`):

```bash
python3 scripts/gen-parity-fixtures.py
```

The script checks out dizione at the commit pinned inside it, downloads the phonemizer data at
the pinned Hugging Face revision (SHA-256 verified) into `~/.cache/tiny-reader-parity`, and
phonemizes dizione's own tricky-sentence list plus [tests/parity/extra.txt](tests/parity/extra.txt).
Add sentences to `extra.txt`, not to the JSON.

Two inputs are known to differ on purpose (initials such as "H. C. Sirr": the JavaScript port has
a fix that Python dizione has not published yet). They are listed in `KNOWN_DIVERGENT` in
[tests/parity/parity.test.ts](tests/parity/parity.test.ts) with the recorded JavaScript output,
and a test fails once that list is no longer needed.

## int8 model experiment

```bash
python3 scripts/quantize-experiment.py
```

Needs `onnxruntime`, `onnx` and `numpy`. It writes two dynamically quantized copies of the model
and WAV files for listening into `.output/int8-experiment/`, and prints size, speed and how far
the output drifts from the float32 model. The add-on ships the float32 model; the comparison and
the reasons are in [docs/FINDINGS.md](docs/FINDINGS.md) §11.

## Before publishing

The engine test page (`playground.html`) is part of every build, reachable only by its `moz-extension://` address.
It ships with the add-on: `pnpm dev` and `tests/e2e/playground.test.ts` use it.

The add-on ID in [wxt.config.ts](wxt.config.ts) is `tiny-reader@tiny-reader`. It cannot be changed once the add-on is
published: a different ID is a different add-on.
