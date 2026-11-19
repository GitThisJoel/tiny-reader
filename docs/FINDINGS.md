# Phase 0 findings

Everything below was checked on 2026-11-19 with code, not taken from docs, unless marked
**(unverified)**. Environment: Node 22.22.1, Firefox 158.0.1 (snap, Linux x86-64),
onnxruntime-web / onnxruntime-node 1.31.1, Python 3.14 + numpy 2.3.5.

Pinned sources:

| What                                        | Revision                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Hugging Face `n4ze3m/tiny-voca`             | `1e73262226dbf4ef02e9df277e81aaa1db5ce16c`                                   |
| GitHub `n4ze3m/tiny-voca`                   | `0eea2be213b53ec0b1949c169b80e611544718e1` (`js/` last changed in `32c5801`) |
| GitHub `n4ze3m/dizione` (Python phonemizer) | `8cd889e4de7be6bd1dd2e6891344a0729fa14dd4`                                   |

Licences: tiny-voca code + weights Apache-2.0; dizione Apache-2.0; phonemizer data derived from
CMUdict (BSD-2-style, `phonemizer/LICENSE.cmudict`) and homograph data (Apache-2.0,
`phonemizer/LICENSE.homograph-data`); onnxruntime-web MIT. All are redistributable in an add-on
if the licence files are bundled.

## Decisions (all four accepted as proposed, 2026-11-19)

1. **Phonemizer source.** Use upstream's pure-JS dizione port (§3). It is third-party plain JS
   (150 KB, 12 files) and lives on GitHub, not Hugging Face. Proposed: `fetch-assets` downloads it
   at the pinned commit with SHA-256 checks (same as the model), it is never committed, and we
   type it with one hand-written `.d.ts`. This bends two of your rules ("no plain JS source
   files", "assets from Hugging Face"). The alternative is porting 150 KB of regex-heavy code to
   strict TypeScript ourselves, which I recommend against: every upstream fix would need
   re-porting and parity would be ours to maintain.
2. **What "the Python reference" is.** The JS port and Python dizione `8cd889e` agree on 571 of
   573 sentences. The 2 that differ are an intentional upstream fix that exists only in the JS
   port so far (§3). Proposed: fixtures are generated from Python dizione at the pinned commit;
   the parity test requires exact equality, except for an explicit, documented list of the
   affected inputs (initials with full stops), which must instead match a recorded JS output.
3. **Where the engine Worker lives** (§7): owned by the background event page, not the content
   script. This matches your architecture, but note the consequence: PCM crosses
   worker → background → content script by structured clone (a copy, not a transfer).
4. **Minimum Firefox: 140** (§6).

## 1. ONNX model I/O

File `onnx/model.onnx`, 21,386,372 bytes, SHA-256
`fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46` (matches the LFS hash
published by Hugging Face). Opset 17, float32.

Printed from `session.inputNames` / `outputNames` / `inputMetadata` / `outputMetadata`
(onnxruntime-node):

| Input         | dtype   | Shape         | Meaning                                                                                                       |
| ------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `tokens`      | int64   | `[1, tokens]` | Phoneme IDs including `<bos>` (1) and `<eos>` (2). IDs are positions in `config.json` → `vocab` (76 symbols). |
| `stress`      | int64   | `[1, tokens]` | Per token: 0 none, 1 primary, 2 secondary.                                                                    |
| `voice`       | int64   | `[1]`         | 0 = F2 (female), 1 = M2 (male).                                                                               |
| `speed`       | float32 | `[1]`         | Divides predicted durations. 1.0 = as predicted, 2.0 = half as long.                                          |
| `pitch_shift` | float32 | `[1]`         | Added to log F0. 0.058 ≈ one semitone. 0 = none.                                                              |
| `pitch_range` | float32 | `[1]`         | Scales pitch movement around the utterance mean. 1.0 = as predicted.                                          |

| Output      | dtype   | Shape          | Meaning                                                     |
| ----------- | ------- | -------------- | ----------------------------------------------------------- |
| `audio`     | float32 | `[1, samples]` | Mono waveform at 24,000 Hz.                                 |
| `durations` | int64   | `[1, tokens]`  | Frames per input token; one frame = 256 samples (10.67 ms). |

There are no other inputs or outputs. In JS the int64 tensors need `BigInt64Array`.

Measured behaviour (same in onnxruntime-node and onnxruntime-web/wasm):

- `sum(durations) * 256 === samples` exactly, at speed 0.5, 1 and 2 and for both voices.
- Durations are deterministic. Audio is **not** bit-reproducible: the graph draws its own noise
  signal each run (peak 0.840 vs 0.845 on two identical calls).
- Audio can exceed full scale: peaks of 1.07 (M2) and 1.14 (speed 2) seen. Each utterance must be
  scaled to ≤ 0.99 before playback, as the reference does.
- Example per-token durations for "Hello! This is tiny voca, …":
  `<bos>:30 h:4 ə:9 l:6 oʊ:27 !:0 ð:4 … <sp>:0 … ,:15 … .:0 <eos>:4`.
  `<bos>` carries ~0.3 s of leading silence, `<sp>` is usually 0, punctuation is 0 or a pause.
  Consecutive utterances therefore already have a natural gap; playback just concatenates.

## 2. How the official browser demo phonemizes

`web/public/worker.js` runs the **Python** dizione package under **Pyodide 0.26.4**, loaded from
the jsDelivr CDN together with onnxruntime-web 1.20.1 (also CDN). `fetch_assets.sh` downloads
`model.onnx`, `config.json` and five phonemizer data files (`lexicon.tsv`, `align.json`,
`g2p.json`, `g2p.npz`, `homographs.json`) from Hugging Face `main`, and zips a local checkout of
the dizione Python source into `dizione.zip`, which the worker unpacks into Pyodide's filesystem.
It calls `dizione.phonemize(text)` and passes `ids` and `stress` to ONNX with
`pitch_shift = 0`, `pitch_range = 1`, one wasm thread.

None of that is usable as-is: it is remote code from a CDN.

Separately, the repo has `js/`: a dependency-free JS port of dizione plus a JS reimplementation
of the model (no ONNX). It reads one file, `gguf/tiny-voca-js.gguf`.

## 3. Phonemizer options

|                              | A. Upstream JS port (`js/dizione/`)                      | B. Pyodide + Python dizione                                                                             | C. Our own TS port              |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Code size                    | 150 KB JS                                                | Pyodide core + stdlib + numpy, roughly 10–15 MB **(unverified, not measured)**                          | ~150 KB TS to write             |
| Data size                    | 7.99 MB (`tiny-voca-js.gguf`) or ~4.5 MB if repacked     | 5.4 MB (`phonemizer/`)                                                                                  | same as A                       |
| Startup                      | 0.55 s in Node (measured)                                | several seconds; demo shows a loading bar **(unverified)**                                              | same as A                       |
| Speed                        | ~1,000 sentences/s (measured)                            | Python native: 2,300/s; under wasm slower **(unverified)**                                              | same as A                       |
| Licence                      | Apache-2.0                                               | Apache-2.0 + MPL-2.0 (Pyodide) + PSF + BSD                                                              | Apache-2.0 derivative           |
| Fidelity vs Python `8cd889e` | 571 / 573 identical (measured)                           | identical by construction                                                                               | ours to prove                   |
| Maintenance                  | upstream keeps parity (claims 0 / 13,973 on its vectors) | none                                                                                                    | every upstream change re-ported |
| AMO                          | plain readable JS, fine                                  | large third-party wasm blob; Pyodide evaluates Python at runtime, reviewers may object **(unverified)** | fine                            |

**Recommendation: A.**

Parity measurement: 573 sentences (dizione's `tests/data/tricky_sentences.txt` plus tiny-voca's
`js/test/sentences.json`) through Python dizione `8cd889e` and through the JS port, comparing
`ids` and `stress`. 571 identical, including the 2 that raise "nothing to pronounce" in both.
The 2 differences:

```
H. C. Sirr wrote it.        Python: eɪ tʃ . s iː . s ɜː …     JS: eɪ tʃ s iː <sp> s ɜː …
F. A. McKenzie wrote it.    Python: ɛ f . eɪ . m ə k …        JS: ɛ f eɪ <sp> m ə k …
```

`js/README.md` says the port "follows dizione with the two fixes for letters with full stops …
and for a page after a number". Those fixes are not in the public dizione repo yet, so the JS
port is intentionally ahead of Python here (and its output is the better one: no sentence-final
stop after each initial).

Which dizione the released model was trained with cannot be pinned exactly. The
`phonemizer.fingerprint` in `config.json` (`c729f235…`) is tiny-voca's wrapper hash over
`{frontend_version: 4, phonemizer: "dizione", symbols}` only (I reproduced the hash from those
three values). It proves token-convention version 4 and the symbol table, not a commit.

Data for option A: the port's `fromGGUF` needs the dictionary, alignment table, homograph data,
g2p weights and ten small text tables. The ten tables are in the dizione GitHub repo and inside
`tiny-voca-js.gguf`, but not in `phonemizer/` on Hugging Face. Simplest: ship
`gguf/tiny-voca-js.gguf` (7,988,384 bytes, SHA-256
`8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653`) and read it with upstream's
`readGGUF`. About half of it is the q8 model weights we do not use. Repacking would save ~4 MB of
a ~45 MB add-on; not worth a custom packer now.

The port needs `DecompressionStream` (Firefox 113+) and nothing else from the platform.

## 4. Per-utterance limits and chunking

- `config.json`: `max_tokens` 512, `max_frames` 3000 (32.0 s). Model card: "up to 512 tokens and
  32 seconds".
- **The ONNX graph does not enforce either.** 513 and 700 tokens ran and returned finite audio
  (38.8 s), and 400 tokens at speed 0.3 returned 76 s. Those are outside what the model was
  trained on, so quality is undefined and cost grows fast: the frame transformers are quadratic
  in frames.
- Measured cost, onnxruntime-web wasm, 1 thread, in Node:

  | Tokens |  Audio | Synthesis time | RSS after run |
  | -----: | -----: | -------------: | ------------: |
  |     60 |  3.1 s |         0.17 s |       ~400 MB |
  |    120 |  5.9 s |         0.37 s |       ~380 MB |
  |    250 | 12.2 s |         0.92 s |       ~580 MB |
  |    500 | 24.2 s |          2.5 s |       ~840 MB |

  (RSS after model load alone: ~310 MB. Firefox numbers will differ; re-measure in Milestone 2.)
  After the 76 s utterance the process sat at 4–5 GB.

- Speed: ~17–21× real time on wasm, ~90–120× on onnxruntime-node. Session creation 0.9 s (wasm).

Reference chunking (`tiny_voca.infer.speak_text`, mirrored in the demo worker): split into
sentences by regex; append "." if the text ends without a mark (otherwise the last word is cut
off); phonemize each sentence; if it has more than `max_tokens − 12` = 500 tokens, split after
`, ; : —`, and if there are none, split the word list in half, recursively. Sentences with
nothing to pronounce (other scripts, symbols only) are skipped.

Plan for the extension:

- Sentences from `Intl.Segmenter` (needed anyway for offsets), then the same
  phonemize-and-split-if-too-long recursion, keeping source offsets for each piece.
- **Token cap 200, not 500.** At ~5.4 frames per token that is ~11 s of audio at speed 1.0,
  ~0.7 s of synthesis and bounded memory, and it stays under `max_frames` down to speed ≈ 0.4
  (speed below 1 multiplies frames, which the reference's 500-token rule ignores).
- Always end a piece with a mark; scale each piece to peak ≤ 0.99.
- "Nothing to pronounce" is the non-English signal at the sentence level (Milestone 7).

## 5. Word-level timing

Feasible, with one caveat.

- Timing side is exact: `durations` is per token, and cumulative sums × 256 / 24,000 give each
  token's start and end in seconds (verified sum equals the audio length).
- The phonemizer does **not** return source character offsets. It normalises text with regex
  substitutions, then emits spoken words. `phonemize()` also merges attached words into one
  group, so counting `<sp>` tokens is not reliable.
- `Phonemizer.analyse(text)` (public in both Python and JS) returns, per clause, the list of
  units with `unit.word` (spoken word text) and `unit.phones`. Walking the units in the same
  order as `tokenize` gives an exact token range per spoken word.
- Spoken words then have to be matched to source words. For plain words they are equal after
  lower-casing; for numbers, money, dates, abbreviations they are expansions
  (`$42.50` → `forty two dollars and fifty cents`; `Dr.` → `doctor`).

Measured with `Intl.Segmenter` word segments vs unit words, aligned by longest common
subsequence:

| Text                                                           | Sentences | Source words anchored exactly |
| -------------------------------------------------------------- | --------: | ----------------------------: |
| tiny-voca + dizione design docs (number-heavy technical prose) |       116 |                        89.7 % |
| dizione tricky sentences (adversarial: numbers, dates, units)  |       509 |                        80.1 % |

Plan: exact matches are anchors; a run of unmatched source words between two anchors shares the
run of unmatched spoken words between them and is highlighted as one span (so `$42.50` lights up
for the whole of "forty two dollars and fifty cents"). No guessing inside a run. Ordinary prose
should be near 100 % anchored; I had no plain-prose corpus offline to put a number on that.

## 6. Minimum Firefox version

From `@mdn/browser-compat-data` 8.1.9, then confirmed live in Firefox 158 where marked ✔.

| API                                                                       | Firefox | Note                                                                                                                                              |
| ------------------------------------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS Custom Highlight API (`Highlight`, `CSS.highlights`, `::highlight()`) | **140** | ✔ present in content scripts. 140–145: no `text-decoration` in `::highlight()`; 140–148: no `text-shadow`. Use `background-color` / `color` only. |
| `Intl.Segmenter`                                                          |     125 | ✔                                                                                                                                                 |
| MV3 (`manifest_version: 3`, `host_permissions`)                           |     109 |                                                                                                                                                   |
| Background event pages (non-persistent)                                   |     106 | MV3 background is always an event page; Firefox has no `service_worker` background.                                                               |
| `background.type: "module"`                                               |     112 |                                                                                                                                                   |
| `'wasm-unsafe-eval'` in extension CSP                                     |     102 | ✔ and required: without it, `WebAssembly.Module()` in an extension Worker fails with "blocked by CSP".                                            |
| `scripting.executeScript` / `scripting` permission                        |     102 |                                                                                                                                                   |
| Module Workers                                                            |     114 |                                                                                                                                                   |
| `DecompressionStream` (JS phonemizer)                                     |     113 |                                                                                                                                                   |
| `data_collection_permissions` manifest key                                |     140 | AMO requires it for new add-ons; ours declares `none`.                                                                                            |
| `menus`, `commands`                                                       | 55 / 48 | Desktop only. Not supported on Firefox for Android.                                                                                               |

**`strict_min_version: "140.0"`**, set by the Highlight API. 140 is also an ESR.
Desktop only: Android lacks `menus` and `commands`.

## 7. Architecture checks (throwaway MV3 extension in headless Firefox 158)

| Question                                                                              | Result                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a content script start a Worker from a `moz-extension://` URL?                    | **No.** Worker errors immediately.                                                                                                                                                 |
| Content script Worker from a Blob URL?                                                | Works on a plain page, runs with the _page's_ origin, and is **blocked** on a page with a strict CSP. Unusable.                                                                    |
| Worker created by the MV3 background event page?                                      | **Works**, origin `moz-extension://`, wasm compiles with `'wasm-unsafe-eval'`. Unaffected by the page's CSP.                                                                       |
| Cross-origin isolation in that Worker?                                                | `crossOriginIsolated === false`, no `SharedArrayBuffer`. Threads are not trivially available → **single-threaded wasm**.                                                           |
| Does a `Float32Array` survive `runtime.Port.postMessage` background → content script? | Yes, arrives as `Float32Array` (structured clone, 48,000 samples tested). A bare `ArrayBuffer` also arrives. It is a copy, not a transfer: ~0.5 MB per 5 s sentence, fine.         |
| Does an open port or a live Worker keep the event page alive?                         | **No.** With an open port, a running Worker and outbound `port.postMessage` every 10 s, the page got `onSuspend` at 30.1 s and the port disconnected.                              |
| Do _inbound_ port messages keep it alive?                                             | **Yes.** With the content script sending a message every 10 s, the page was still alive at 70 s (end of test).                                                                     |
| Is `CSS.highlights` set from a content script isolated from the page?                 | No. It is the document's registry; page script can see the entry (`wrappedJSObject.CSS.highlights.has(...)` was true). No DOM node is added, but the highlight name is observable. |
| `AudioContext({ sampleRate: 24000 })` in a content script                             | Created at 24 kHz, state `suspended` with no user gesture (headless). Not yet tested with a real gesture.                                                                          |

Consequences:

- **Engine Worker is owned by the background event page.** Content script ↔ background over a
  `runtime.Port`; background ↔ Worker over `postMessage`. Same as the planned architecture.
- **Keep-warm and release come from the event-page lifecycle.** While reading, the content
  script's synth requests (plus a heartbeat every ~20 s while audio is playing or queued) keep
  the page, and so the Worker and the loaded model, alive. When reading stops, the heartbeat
  stops and Firefox unloads everything after 30 s. No idle timer of our own. The content script
  must treat port disconnect as "engine gone" and reconnect on the next request.
- Highlight styling: inject the `::highlight()` rule with `scripting.insertCSS` (no DOM node, not
  subject to page CSP) rather than a `<style>` element.
- **Risk to settle in Milestone 3: autoplay.** Selecting text and using the context menu or a
  shortcut should count as user activation of the page, but that is unverified. If the content
  script's `AudioContext` stays suspended, the fallback is to resume it on the first click on
  our control bar ("Press play to start").
- An extension iframe hosting the Worker also worked, even under a page CSP with
  `frame-src 'none'`. Not needed, and it would add a DOM node; noted only as a fallback.

## 8. Other things found along the way

- **ONNX Runtime Web 1.31.1**: `ort-wasm-simd-threaded.wasm` is 14.8 MB and works with
  `numThreads = 1`. No `eval(` or `new Function` in `ort.wasm.min.mjs` or the wasm glue (grep),
  so `script-src 'self' 'wasm-unsafe-eval'` should suffice. To confirm inside the extension in
  Milestone 2.
- Estimated add-on size: model 21.4 MB + ORT wasm 14.8 MB + phonemizer file 8.0 MB ≈ 45 MB
  unpacked. AMO's limit is 200 MB.
- **`web-ext run` with snap Firefox fails** (`ECONNREFUSED`): the snap cannot see the temporary
  profile. Passing `--firefox=/snap/firefox/current/usr/lib/firefox/firefox` works. `pnpm dev`
  needs this on this machine; the README will say so.
- `pnpm` is not installed here, and the local Corepack (0.24) cannot launch pnpm 12. The
  `packageManager` field still pins the version; pnpm itself has to be installed separately.
- This machine's Node 22.22.1 (distro build) has no built-in TypeScript stripping
  (`process.features.typescript` is `false`, even with `--experimental-strip-types`), so
  scripts run through `tsx` instead of plain `node file.ts`.
- `web-ext lint` reports one warning and no errors: `strict_min_version` 140 predates Firefox
  for Android 142, the first Android release with `data_collection_permissions`. The add-on is
  desktop only (§6), so the warning is accepted.
- Hugging Face publishes SHA-256 only for LFS files (`model.onnx`, the GGUFs, `g2p.npz`). For
  the small files the hashes pinned in `fetch-assets` will be the ones computed at the pinned
  revision.
- The model reads the same text the same way every time (no prosody sampling), so a re-synthesis
  after a skip or a cache miss has the same durations and word timings.
