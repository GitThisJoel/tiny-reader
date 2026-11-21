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

## 9. Milestone 2 measurements (real add-on, headless Firefox 158)

- The engine runs under the add-on CSP `script-src 'self' 'wasm-unsafe-eval'` with no changes:
  ONNX Runtime's loader is fetched with a dynamic `import()` from the add-on package inside a
  classic Worker.
- `onnxruntime-web/wasm` must be resolved with the export condition
  `onnxruntime-web-use-extern-wasm`. The default build embeds the wasm binary, and Vite then
  inlined it as base64, giving a 40 MB worker script.
- First sentence after a cold start (Worker start, model and phonemizer load, synthesis):
  **1.08 s** for 1.9 s of audio. Warm: 82 ms for 1.9 s, 236 ms for 5.2 s, 729 ms for 11.6 s
  (about 16–24× real time).
- Built add-on: 44.4 MB unpacked, 30.5 MB zipped.
- WebDriver BiDi cannot navigate to `moz-extension://` pages ("not allowed in this context").
  The end-to-end tests use Marionette instead, which can, and whose clicks are real input
  events.

## 10. Milestone 3 results (real pages, headless Firefox 158)

- **Autoplay risk resolved.** Right-clicking the selection to open the context menu gives the
  page user activation (`navigator.userActivation.hasBeenActive` is true afterwards), and the
  content script's `AudioContext` runs with no further click, under Firefox's default
  `media.autoplay.default = 5`. The "Press play to start" state stays as a fallback.
- **Xray pitfall.** In a content script, `AudioBuffer.getChannelData(0).set(pcm)` throws
  "Permission denied to access object": the channel array belongs to the page, and page code
  may not read the content script's array. `AudioBuffer.copyToChannel(pcm, 0)` works.
- A page CSP of `default-src 'none'` with `script-src`, `style-src`, `media-src`, `worker-src`,
  `frame-src` and `connect-src` all `'none'` changes nothing: the bar's constructed stylesheet
  applies, audio plays, and the engine is reached. The end-to-end suite runs every reading test
  on such a page.
- `wxt/browser` types have `contextMenus` but not Firefox's `menus` alias. Firefox supports
  both, so the add-on uses `contextMenus`.

## 11. Milestone 4 results

- `CSS.highlights.set(name, new Highlight(range))` from the content script and a
  `::highlight()` rule added with `scripting.insertCSS` paint correctly, also on a page whose
  CSP has `style-src 'none'`. `document.body.innerHTML` is identical before and after a reading.
- `::selection` paints over `::highlight()`, so the selection is cleared when reading starts.
- Source newlines inside a paragraph must be mapped to spaces (length-preserving) before
  segmentation: `Intl.Segmenter` treats a line feed as a sentence end.
- Not done: scrolling the page to follow the highlight. It was not asked for; say if you want it.

## 12. Milestone 5 results

- Word-level highlighting is implemented as planned in §5: token durations give exact times
  for spoken words, and longest-common-subsequence anchors map them to source words. In the
  real add-on the word highlight changes as the audio plays and always lies inside the sentence
  highlight.
- The alignment runs in the engine Worker, per piece of at most 300 characters, so its
  quadratic table stays small (a few thousand cells).
- The playback position is `AudioContext.currentTime − outputLatency − start time of the
  utterance`. Not verified by ear in this headless setup: whether the highlight is perceptibly
  early or late on real speakers.

## 13. Milestone 6 results

- "Read from here" needs to know where the context menu was opened, but the content script is
  only injected after the click (activeTab). Firefox's `menus.getTargetElement(targetElementId)`
  solves this from the content script. It exists only under the `menus` namespace, so the
  permission is `menus`, not the `contextMenus` alias chosen in §10.
- The start is the beginning of the block that holds the clicked element, not the clicked
  word: the pointer position is not available to a script injected after the click.
- A keyboard command grants activeTab like a menu click. Audio started from a shortcut plays
  when the page has been interacted with before (verified after one real click in the page).
  The end-to-end tests trigger the registered `<key>` element rather than typing the keys:
  synthesized key presses do not reach Firefox's shortcut handling in headless mode. Triggering
  by "Alt+Shift+R" fails unless that exact shortcut is registered, so the defaults are covered.
- A shortcut is sent to every frame the add-on can reach, since any frame may hold the
  selection. A reading started in one frame does not stop one already running in another.

## 14. Milestone 7 results

### Long pages

"Read from here" maps and segments the whole rest of the article before the bar appears.
Measured in headless Firefox 158, from the menu click to the bar appearing (this includes
opening the menu and injecting the script, about 250 ms on their own):

| Paragraphs | Sentences | Click to bar |
| ---------: | --------: | -----------: |
|        100 |       300 |       251 ms |
|      2,000 |     6,000 |       311 ms |
|     10,000 |    30,000 |       651 ms |

So the up-front work costs about 40 µs per paragraph: 60 ms for a very long article, 0.4 s
for a book-sized page. It is left as it is; the code names the upgrade path (map block by
block). After the start, every step is logarithmic or constant in the page size: skipping
two sentences on the 6,000-sentence page takes as long as on a short one.

### Long and awkward sentences

- The content script cuts sentences longer than 300 characters at commas, then between words,
  so a 2,900-character run-on sentence starts playing as fast as a short one (13 pieces).
- The engine cuts again by tokens (200) for text that expands, such as long digit strings.
- A single word over the token limit with no space in it is dropped and the rest is read.
  Measured: a 1,500-letter "word" is no problem (the phonemizer gives it a short guess); a
  150-digit number is dropped.

### Other languages

- Other scripts: the phonemizer reports nothing to pronounce, the sentence is skipped, and if
  nothing at all could be read the bar says so.
- Other languages in Latin script would be read with English sounds. `i18n.detectLanguage`
  (Firefox's built-in detector; it runs locally and works in a content script) is given the
  first 4,000 characters. A reliable non-English result puts a warning in the bar, naming the
  language. Reading continues: the user asked for it, and detection can be wrong.

### Errors in the UI

Every failure ends in the bar's status line: engine errors, a lost engine after one retry,
playback exceptions, nothing readable, nothing to read. The one case with no UI is a page
where add-ons may not run at all (about: pages, addons.mozilla.org): nothing can be injected,
so the failure is only logged in the background page's console.

### int8 experiment

`scripts/quantize-experiment.py`, onnxruntime 1.32.0 `quantize_dynamic` with int8 weights,
18 of tiny-voca's test sentences in both voices (38 utterances, 165 s of audio):

|                                                     |                          float32 |    int8 (MatMul + Conv) |      int8 (MatMul only) |
| --------------------------------------------------- | -------------------------------: | ----------------------: | ----------------------: |
| File size                                           |                         21.39 MB |          8.12 MB (38 %) |          8.55 MB (40 %) |
| Speed, onnxruntime-web wasm, 1 thread (Node)        |                  21.9× real time |                   30.1× |                   30.1× |
| Session creation, same                              |                          1017 ms |                  562 ms |                  447 ms |
| Speed, native onnxruntime, 1 thread                 |                            60.1× |                   62.8× |                   67.2× |
| Utterances whose durations are identical to float32 |                      (reference) |                 2 of 38 |                 1 of 38 |
| Change in utterance length                          |                                  | 1.23 % mean, 2.51 % max | 1.30 % mean, 2.51 % max |
| Log-spectral distance to float32                    | 6.30 dB (float32 against itself) |                 7.67 dB |                 7.59 dB |

Reading the table:

- **Size**: 13 MB smaller, which would take the unpacked add-on from 44 MB to about 31 MB.
- **Speed**: about 37 % faster in the browser runtime, and the session starts in half the time.
- **Quality**: not established. I cannot listen to audio, so there is no A/B by ear from me.
  The numbers say the output is not the same speech: the duration predictor gives different
  lengths in 36 of 38 utterances (by about 1 %, so rhythm shifts slightly), and where the
  durations do match, the spectrum is 1.3 dB further from float32 than float32 is from itself
  with new noise. The spectral figure rests on only 1–2 utterances, so it is weak evidence.
  Upstream saw the same pattern: its Q8 file with one scale per 32 weights keeps durations in
  19 of 20 utterances, and a coarser scale kept only 14. onnxruntime's dynamic quantization
  uses one scale per tensor, which is coarser still.
- Leaving the convolutions in float32 (the "MatMul only" column) does not help.

**Decision: the add-on keeps float32.** 44 MB is far under AMO's limit, synthesis is already
16–24× real time, and the int8 output is measurably different with no listening test behind
it. To judge it yourself, run the script and compare the WAV pairs in
`.output/int8-experiment/`. If size becomes a goal, the better route is upstream's
block-scaled Q8 weights, which would need a custom ONNX export.

## 15. Reader View and other pages add-ons cannot enter

Tested in headless Firefox 158 on `about:reader?url=…`:

- `scripting.executeScript` and `scripting.insertCSS` fail with "Missing host permission for
  the tab", both with `activeTab` granted by a context-menu click and with `<all_urls>` granted
  as a host permission. No permission opens Reader View to an add-on.
- The context menu entries still appear there, and `tab.isInReaderMode` and `tab.url` are
  readable, so the add-on can tell where it is.
- `tabs.toggleReaderMode(tabId)` works, but leaving Reader View is a navigation and drops the
  `activeTab` grant: straight afterwards `tab.url` is hidden again and injection fails. The
  add-on cannot leave Reader View and carry on reading in one step without a host permission
  for the article's site.

**PDFs are the same.** A PDF opened in Firefox's built-in viewer, from `http://` or from
`file://`, has a selectable text layer and shows the context menu entries, but injection fails
with the same "Missing host permission for the tab", again also with `<all_urls>` granted.

What the add-on does: a reading that cannot start marks the toolbar button for that tab with a
"!" badge and the reason as its tooltip, and the popup shows the reason instead of closing.

Two ways to actually read such text, neither built:

1. Read the selection in a page of the add-on's own. The context menu click delivers the
   selected text (`info.selectionText`), which could be shown and read, with highlighting, in a
   small add-on window. No new permission; selections only; nothing happens inside Reader View.
2. Ask for access to the article's site (`optional_host_permissions`, a prompt per site), leave
   Reader View and read the original page. Reads whole pages; costs a permission prompt and
   takes the user out of Reader View.

## 16. Reading PDFs

Since the add-on cannot enter Firefox's PDF viewer (§15), it reads PDFs in a page of its own
(`document.html`), where the user opens or drops the file.

- **No permission and no network.** The file comes from a file picker or a drop, is parsed by
  pdf.js (`pdfjs-dist` 6.5.438, bundled, 1.7 MB) in a Worker of the page, and never leaves it.
  pdf.js is told not to fetch anything: `useWorkerFetch: false`, `useWasm: false`
  (and, until pages were drawn, §17, `disableFontFace: true`).
- **The PDF open in another tab cannot be picked up automatically.** Tested from an add-on page
  in Firefox 158: `fetch` and `XMLHttpRequest` of a `file://` PDF fail with a network error,
  both without host permissions and with `<all_urls>` granted. So a local PDF always has to be
  chosen or dropped by the user. An `http(s)` PDF can be fetched once the add-on has a host
  permission for that site (200, full file); without one it fails the same way.
- **Web PDFs are downloaded on request.** The original constraints were no network access at
  runtime and no host permissions; the user chose to relax both for this one case
  (2026-11-21). `optional_host_permissions: ["*://*/*"]` is declared, nothing is granted at
  install, and the document page calls `permissions.request` for the PDF's site only (scheme and
  host, as match patterns carry no port) from a click on that page. With the permission it
  fetches the PDF with `credentials: "include"`, so a PDF behind a login the browser already has
  opens too. This is the add-on's only network request. Verified in Firefox by clicking through
  the real permission prompt: accepted (PDF opens, and the next PDF from that site opens with no
  prompt), refused (nothing is downloaded), and a 404 from the site.
- **Text, not layout.** `getTextContent()` gives positioned runs. Lines are found by baseline,
  paragraphs by vertical gap and font size, a word hyphenated at a line end is rejoined, page
  numbers are dropped, and a sentence that runs over a page break is carried on. Verified on a
  generated two-page PDF in real Firefox; not yet tried on a range of real-world PDFs.
- **Everything else is shared.** The page uses the same controller as the content script, and
  `tabs.sendMessage` reaches an add-on page shown in a tab, so the popup, the shortcuts and both
  context menu entries (including `menus.getTargetElement`) work there unchanged. The background
  only has to skip injection for that page.
- `web-ext lint` gains two `UNSAFE_VAR_ASSIGNMENT` warnings, both inside pdf.js.
- **Telling the user.** Nothing can be shown inside the PDF viewer, and the add-on only learns
  what a tab holds once the user invokes it there, so there is no warning while merely viewing a
  PDF. When a reading cannot start, `action.openPopup()` opens the toolbar popup (verified: the
  panel opens after a failed context-menu read). The popup finds out whether its tab can be read
  by running a script that does nothing; if that fails and the address ends in `.pdf`, it offers
  the document page and passes the file name along, since the user has to pick the file again.
- **Recognising a PDF tab.** The add-on cannot look into the viewer, and the tabs API has no
  content type. An address ending in `.pdf` is one sign; many PDFs lack it
  (`arxiv.org/pdf/1706.03762`). The viewer titles its tab with the file name
  ("1706.03762v7.pdf", or "Title - file.pdf"), so a blocked tab whose title ends in `.pdf`
  counts as a PDF too.
- **A real paper.** `https://arxiv.org/pdf/1706.03762` (15 pages) went through the whole flow in
  headless Firefox: recognised, permission prompt for arxiv.org accepted, downloaded and parsed
  in 1.1 s, 369 paragraphs, reading started. Running prose came out as proper paragraphs. More
  than half of the "paragraphs" were under 20 characters: section headings, but mostly pieces
  of formulas and table cells, which are read as they come. Footnotes and the arXiv margin
  stamp are read in page order. Filtering those is not built.

## 17. Highlighting on the PDF's pages

The document page first showed the extracted text as paragraphs. It now shows the pages
themselves and paints the highlight on them (2026-11-21). Firefox's own viewer stays out of
reach (§15), so "in the PDF" means in the add-on's page.

- **Drawing works under the add-on's CSP.** `page.render()` onto a canvas plus pdf.js's
  `TextLayer` run with `script-src 'self' 'wasm-unsafe-eval'` and no further data files.
  Embedded fonts are loaded through the FontFace API from the PDF's own bytes
  (`disableFontFace` is no longer set; with the arXiv paper open, `document.fonts` held its
  fonts as `loaded`); nothing is fetched. A font the PDF does not embed
  (Helvetica in the generated test PDF) is drawn with a system font, since pdf.js's
  `standard_fonts` (820 kB) are not bundled. Nor are its wasm image decoders (1.4 MB) or CMaps
  (1.7 MB); what a PDF with JPEG 2000 or JBIG2 images looks like without them has not been
  tried.
- **The highlight needs no new mechanism.** The text layer is real DOM text, one `<span>` per
  text run, transparent and positioned over the canvas, so the CSS Custom Highlight API works
  on it as on a web page. The colours are see-through and the highlighted text stays
  transparent, so the drawn page shows beneath. Checked by eye on a screenshot of
  `arxiv.org/pdf/1706.03762`: sentence and word marks sit on the right glyphs.
- **Reading the text layer directly would not work.** Its spans are absolutely positioned, so
  the DOM text map sees each as a block of its own and every line would be a "sentence".
  Instead `pdfText` builds the paragraphs as before and also records, for every word, the run
  and offset it came from. `TextLayer.textDivs` has one span per run in the same order (checked
  in the pdf.js source: a span is pushed for every item with `str`, even an empty one), which
  gives the text node for each word. The controller takes this map in place of the DOM one;
  selections and "read from here" are translated through it.
- **One range per sentence.** A sentence that runs over a page break spans the page number
  between its halves. Spans that are not read get `data-unread`, and a
  `[data-unread]::highlight()` rule keeps them uncoloured; Firefox applies `::highlight` rules
  per element (computed style checked in the tests, and the uncoloured page number seen on a
  screenshot).
- **Cost.** Text layers for all pages are built when the file is opened; canvases are drawn
  only within one window height of the view and emptied after. Measured in headless Firefox:
  the arXiv paper (15 pages, 2,286 spans) opened in 0.5 s; generated PDFs of 100 and 500 pages
  with 40 lines each opened in 0.5 s and 2.2 s, and reading started 0.07 s and 0.16 s after
  the click.
- **Following.** The page jumps to a sentence that starts out of view, but only while the
  previous sentence was at least partly in view, so scrolling away to look at something is not
  undone. Web pages are still not scrolled.
- Pages refit when the window is resized (one CSS variable scales the text layer; visible
  canvases are redrawn).
- **Rotated pages.** pdf.js lays the text layer out unturned and sets `data-main-rotation` on
  it; its stylesheet turns the layer with three transform rules, which had to be copied too.
  Tested with a generated page with `/Rotate 90`: the text's box lies on the drawn ink.
- **Pages of different sizes** are all scaled by one factor, chosen so the widest fits. Tested
  with a page three times as wide as the first.
- **Found in review (2026-11-21).** A reading stopped by hand did not tell the page that no
  sentence was being read, so a later reading was not followed if the window had been
  scrolled away. A selection that starts at an element boundary was read from the start of
  its paragraph. Blank runs between words counted as "not read" and would have left holes in
  the highlight. `saveSettings` reads before it writes, so two quick changes in the control bar
  could lose one; saves are now ordered inside it, for every caller. All have tests.
