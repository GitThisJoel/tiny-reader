# Findings

What was checked while building Tiny Reader, and the decisions that rest on it. Everything here was measured or
tested with code unless marked **(unverified)**. It explains choices that look odd without it: why the engine lives in
the background page, why PDFs get a page of their own, why Firefox 140.

Checked 2026-11-19 to 2026-11-21 with Node 22.22.1, Firefox 158.0.1 (Linux x86-64, headless), onnxruntime-web 1.31.1
and pdf.js 6.5.438. Nothing in the automated runs was listened to, the downloadable voices of §13 and the other
languages of §14 included.

Pinned sources:

| What                                        | Revision                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Hugging Face `n4ze3m/tiny-voca`             | `1e73262226dbf4ef02e9df277e81aaa1db5ce16c`                                   |
| GitHub `n4ze3m/tiny-voca`                   | `0eea2be213b53ec0b1949c169b80e611544718e1` (`js/` last changed in `32c5801`) |
| GitHub `n4ze3m/dizione` (Python phonemizer) | `8cd889e4de7be6bd1dd2e6891344a0729fa14dd4`                                   |

## 1. The model

`onnx/model.onnx`: 21,386,372 bytes, opset 17, float32, SHA-256 `fe6d9187…a1ae46` (the hash Hugging Face publishes).

| Input         | dtype   | Shape         | Meaning                                                                             |
| ------------- | ------- | ------------- | ----------------------------------------------------------------------------------- |
| `tokens`      | int64   | `[1, tokens]` | Phoneme IDs with `<bos>` (1) and `<eos>` (2): positions in `config.json` → `vocab`. |
| `stress`      | int64   | `[1, tokens]` | Per token: 0 none, 1 primary, 2 secondary.                                          |
| `voice`       | int64   | `[1]`         | 0 = F2 (female), 1 = M2 (male).                                                     |
| `speed`       | float32 | `[1]`         | Divides predicted durations. 2.0 is half as long.                                   |
| `pitch_shift` | float32 | `[1]`         | Added to log F0. 0.058 is about one semitone.                                       |
| `pitch_range` | float32 | `[1]`         | Scales pitch movement around the utterance mean.                                    |

| Output      | dtype   | Shape          | Meaning                                                     |
| ----------- | ------- | -------------- | ----------------------------------------------------------- |
| `audio`     | float32 | `[1, samples]` | Mono waveform at 24,000 Hz.                                 |
| `durations` | int64   | `[1, tokens]`  | Frames per input token; one frame = 256 samples (10.67 ms). |

- `sum(durations) * 256 === samples` exactly, at every speed and for both voices. This is what word timing rests on.
- Durations are deterministic, so a re-synthesis after a skip has the same word timings. Audio is not
  bit-reproducible: the graph draws its own noise each run.
- Audio can exceed full scale (peaks of 1.07 and 1.14 seen), so each utterance is scaled to a peak of 0.99.
- `<bos>` carries about 0.3 s of leading silence. Consecutive utterances therefore have a natural gap, and playback
  only has to place them end to end.

## 2. The phonemizer

The official browser demo runs the Python phonemizer (dizione) under Pyodide, loaded from a CDN: remote code, not
usable in an add-on. The tiny-voca repository also has a dependency-free JavaScript port of dizione. The add-on uses
that port, fetched at a pinned commit and never committed, typed with one hand-written `.d.ts`.

- **Why not port it to TypeScript ourselves:** 150 kB of regex-heavy code whose every upstream fix would need
  re-porting. Why not Pyodide: roughly 10–15 MB more **(unverified)** and Python evaluated at runtime.
- **Parity.** 573 sentences through Python dizione `8cd889e` and through the JS port: 571 identical. The two that
  differ are an intentional upstream fix that exists only in the JS port so far: no sentence-final stop after each
  initial of a name ("H. C. Sirr wrote it."). The parity test requires equality except for a documented list of those
  inputs, which must match a recorded JS output.
- **Speed:** 0.55 s to start, about 1,000 sentences per second (Node).
- **Data.** The port reads one file, `gguf/tiny-voca-js.gguf` (7,988,384 bytes). About half of it is model weights
  the add-on does not use; repacking would save about 4 MB and was not worth a custom packer.
- The `phonemizer.fingerprint` in `config.json` proves the token convention and symbol table, not a dizione commit:
  which dizione the released model was trained with cannot be pinned exactly.
- The port needs `DecompressionStream` (Firefox 113) and nothing else from the platform.

## 3. Length limits and cutting

- `config.json` says 512 tokens and 3,000 frames (32 s) at most. **The ONNX graph enforces neither**: 700 tokens ran,
  and 400 tokens at speed 0.3 returned 76 s of audio and left the process at 4–5 GB. Outside the trained range quality
  is undefined and cost grows fast.
- Cost, onnxruntime-web wasm, one thread, in Node:

  | Tokens |  Audio | Synthesis time | Memory after the run |
  | -----: | -----: | -------------: | -------------------: |
  |     60 |  3.1 s |         0.17 s |              ~400 MB |
  |    120 |  5.9 s |         0.37 s |              ~380 MB |
  |    250 | 12.2 s |         0.92 s |              ~580 MB |
  |    500 | 24.2 s |          2.5 s |              ~840 MB |

- **The engine cuts at 200 tokens, not the reference's 500.** That is about 11 s of audio and 0.7 s of synthesis, with
  bounded memory, and it stays under the frame limit down to speed 0.4.
- Before that, the reader cuts sentences longer than 300 characters at commas, then between words, so a
  2,900-character run-on sentence starts as fast as a short one.
- Every piece ends with a mark; without one the last word is cut off.
- A single word over the token limit with no space in it is dropped and the rest is read. A 1,500-letter "word" is no
  problem; a 150-digit number is dropped.

## 4. Word timing

- Token durations give exact start and end times. The phonemizer keeps no source positions: it rewrites text
  (`$42.50` becomes "forty two dollars and fifty cents") and then emits spoken words.
- `Phonemizer.analyse(text)` gives the spoken words with their tokens. Spoken words are matched to source words by
  longest common subsequence: exact matches are anchors, and a run of unmatched source words shares the time of the
  unmatched spoken words between two anchors. So `$42.50` is highlighted for all of its expansion, and nothing is
  guessed inside a run.
- Source words anchored exactly: 89.7 % on number-heavy technical prose, 80.1 % on adversarial sentences (numbers,
  dates, units). Ordinary prose should be near 100 %; not measured.
- The alignment runs in the engine Worker per piece of at most 300 characters, so its table stays small.
- The playback position is `AudioContext.currentTime − outputLatency − start of the utterance`. Whether the highlight
  is perceptibly early or late on real speakers has not been measured.

## 5. Firefox version and platform

| API                                        | Firefox | Note                                                                                         |
| ------------------------------------------ | ------: | -------------------------------------------------------------------------------------------- |
| CSS Custom Highlight API                   | **140** | Works in content scripts. 140–145 ignore `text-decoration` in `::highlight()`: colours only. |
| `data_collection_permissions` manifest key |     140 | Required by addons.mozilla.org for new add-ons; this one declares `none`.                    |
| `Intl.Segmenter`                           |     125 |                                                                                              |
| Module Workers, `DecompressionStream`      | 114/113 |                                                                                              |
| `'wasm-unsafe-eval'` in the extension CSP  |     102 | Required: without it wasm compilation in an extension Worker is blocked.                     |
| MV3, `scripting`, background event pages   | 109/102 | Firefox has no service-worker background.                                                    |
| `menus`, `commands`                        |   55/48 | Desktop only.                                                                                |

**`strict_min_version` is 140**, set by the Highlight API; 140 is also an ESR. **Desktop only**: Firefox for Android
lacks `menus` and `commands`.

## 6. Where things can run

Checked with a throwaway MV3 add-on:

| Question                                                         | Result                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Can a content script start a Worker from a `moz-extension:` URL? | **No.** It errors at once.                                                    |
| From a Blob URL?                                                 | It runs with the page's origin and is blocked by a strict page CSP. Unusable. |
| A Worker created by the background event page?                   | **Works**, unaffected by any page's CSP.                                      |
| Threads in that Worker?                                          | No: not cross-origin isolated, no `SharedArrayBuffer`. Single-threaded wasm.  |
| Does PCM survive `runtime.Port` to the content script?           | Yes, as a `Float32Array`. It is a copy, about 0.5 MB per 5 s sentence.        |
| Does an open port or a live Worker keep the event page alive?    | **No.** It was suspended after 30 s.                                          |
| Do messages arriving on the port keep it alive?                  | **Yes.**                                                                      |
| Is `CSS.highlights` hidden from the page?                        | No. No DOM node is added, but page script can see the highlight's name.       |

What follows from it:

- **The engine Worker belongs to the background event page.** Reader ↔ background over a `runtime.Port`, background ↔
  Worker over `postMessage`.
- **Keep-warm and release come from the event page's own lifecycle.** While reading, the reader's requests and a ping
  every 20 s keep the page, and so the loaded model, alive. When reading stops Firefox unloads everything after 30 s.
  The reader treats a disconnected port as "engine gone" and reconnects.
- Highlight colours are added with `scripting.insertCSS`: no `<style>` element, and no page CSP applies.
- **Autoplay.** Opening the context menu on a selection gives the page user activation, and audio starts with no
  further click. A shortcut works once the page has been interacted with. "Press play to start" remains as a fallback.
- **Xray pitfall.** In a content script `AudioBuffer.getChannelData(0).set(pcm)` throws "Permission denied";
  `copyToChannel` works.
- A page CSP that forbids scripts, styles, media, workers, frames and connections changes nothing. The end-to-end
  tests read on such a page.

## 7. Build and speed

- `onnxruntime-web/wasm` must be resolved with the export condition `onnxruntime-web-use-extern-wasm`. The default
  build embeds the wasm binary, which Vite inlined as base64 into a 40 MB worker script.
- The engine runs under `script-src 'self' 'wasm-unsafe-eval'` unchanged. ONNX Runtime fetches its loader from the
  add-on package with a dynamic `import()`, which is one of the linter's warnings.
- First sentence after a cold start (Worker, model, phonemizer, synthesis): **1.08 s** for 1.9 s of audio. Warm: 82 ms
  for 1.9 s, 729 ms for 11.6 s, about 16–24 times real time.
- Size: 46 MB unpacked, 31 MB zipped. The model is 21 MB, ONNX Runtime's wasm 15 MB, the phonemizer data 8 MB.
- Hugging Face publishes SHA-256 only for large files. For the small ones the pinned hashes were computed at the
  pinned revision.

## 8. Reading web pages

- Highlights set from the content script paint correctly, also where the page's CSP has `style-src 'none'`.
  `document.body.innerHTML` is identical before and after a reading.
- `::selection` paints over `::highlight()`, so the selection is dropped when reading starts.
- A line feed inside a paragraph is mapped to a space before segmenting: `Intl.Segmenter` treats it as a sentence end.
- **Read from here.** The content script is injected only after the menu click, so it cannot see the pointer.
  `menus.getTargetElement` gives the element; it exists only under `menus`, which is why the permission is `menus` and
  not `contextMenus`. Reading starts at the block that holds the element.
- A shortcut goes to every frame the add-on can reach, since any may hold the selection. A reading in one frame does
  not stop one in another.
- **Long pages.** The whole range is mapped and segmented before the bar appears, at about 40 µs per paragraph:

  | Paragraphs | Sentences | Menu click to bar |
  | ---------: | --------: | ----------------: |
  |        100 |       300 |            251 ms |
  |      2,000 |     6,000 |            311 ms |
  |     10,000 |    30,000 |            651 ms |

  About 250 ms of each is opening the menu and injecting the script. After the start every step is constant or
  logarithmic in the page size.

- **Other languages.** Other scripts give nothing to pronounce and are skipped. Latin-script languages would be read
  with English sounds, so `i18n.detectLanguage` (local, built into Firefox) is given the first 4,000 characters, and a
  reliable non-English result puts a warning in the bar. Reading continues: detection can be wrong.
- Every failure ends in the bar's status line. Where nothing can be injected at all, see §9.
- Web pages are not scrolled to follow the reading. Only the PDF page is (§10).

## 9. Pages add-ons cannot enter

- **Reader View.** `scripting.executeScript` fails with "Missing host permission for the tab", with `activeTab` and
  also with `<all_urls>` granted. No permission opens it. `tabs.toggleReaderMode` works but is a navigation and drops
  the `activeTab` grant, so the add-on cannot leave Reader View and carry on reading in one step.
- **Firefox's PDF viewer** is the same, for `http:` and `file:` alike.
- Also Firefox's own pages and addons.mozilla.org.
- The context menu entries still appear in all of them, so a reading can be asked for and fail.

What the add-on does: the toolbar button gets a "!" badge and the reason as its tooltip for that tab, and
`action.openPopup()` opens the popup, which explains (verified after a failed context-menu read). The popup finds out
whether its tab can be read by running a script that does nothing.

Not built for Reader View: reading the selection in an add-on window, or asking for the site's permission and leaving
Reader View. Both were declined.

## 10. PDFs

PDFs are read in a page of the add-on's own (`document.html`).

**Getting the file**

- From a file picker or a drop: no permission, no network.
- **A local PDF open in a tab cannot be picked up.** From an add-on page, `fetch` and `XMLHttpRequest` of a `file:`
  PDF fail, with and without `<all_urls>`. The user has to choose the file; the page names it.
- **A PDF on the web is downloaded on request.** This relaxes two original constraints (no network at runtime, no
  host permissions), agreed for this one case on 2026-11-21. `optional_host_permissions: ["*://*/*"]` is declared,
  nothing is granted at install, and the page requests access to the PDF's site only, from a click. It fetches with
  the browser's cookies for that site, so a PDF behind a login already made should open too **(not tried)**. Verified
  by clicking through Firefox's real prompt: accepted, refused, and a 404.
- **Recognising a PDF tab.** The tabs API has no content type. An address ending in `.pdf` is one sign; many lack it
  (`arxiv.org/pdf/1706.03762`). The viewer titles its tab with the file name, so a blocked tab whose title ends in
  `.pdf` counts too.

**Showing and reading it**

- Each page is drawn on a canvas by pdf.js, with pdf.js's text layer over it: real DOM text, one `<span>` per text
  run, transparent. This works under the add-on's CSP with no further data files. Embedded fonts load through the
  FontFace API from the PDF's own bytes.
- **Not bundled:** pdf.js's standard fonts (820 kB), wasm image decoders (1.4 MB) and CMaps (1.7 MB). A font the PDF
  does not embed is drawn with a system font. PDFs with JPEG 2000 or JBIG2 images have not been tried.
- **The highlight** is the same CSS Custom Highlight API, on the text layer, in see-through colours.
- **The text layer cannot be read as it is**: its spans are positioned one by one, so every line would be a sentence.
  `pdfText` rebuilds paragraphs from the runs (lines by baseline, paragraphs by gap and font size, hyphenated words
  rejoined, page numbers dropped, sentences carried over page breaks) and records which run each word came from.
  `TextLayer.textDivs` has one span per run in the same order, which gives each word its text node.
- A sentence is one range, so one that crosses a page break spans the page number. Spans that are not read are
  marked, and a `::highlight()` rule leaves them uncoloured.
- **Rotated pages:** pdf.js lays the text out unturned and sets `data-main-rotation`; its three transform rules had
  to be copied. **Pages of different sizes** are scaled alike so that the widest fits. Both tested with generated
  PDFs only.
- The page jumps to a sentence that starts out of view, but only while the previous one was in view, so scrolling
  away to look at something is not undone.

**Cost**

- Text layers for all pages are built on opening; canvases are drawn within one window height of the view and
  released after.
- `arxiv.org/pdf/1706.03762` (15 pages, 2,286 spans) opened in 0.5 s. Generated PDFs of 100 and 500 pages opened in
  0.5 s and 2.2 s, and reading started 0.07 s and 0.16 s after the click.

**What comes out of a real paper.** Running prose reads as proper paragraphs. More than half of the 369 "paragraphs"
of the arXiv paper are under 20 characters: headings, but mostly pieces of formulas and table cells, read as they
come. Footnotes and the margin stamp are read in page order. Columns are not detected. Filtering is not built.

## 11. A smaller model (not adopted)

`scripts/quantize-experiment.py`: onnxruntime 1.32.0 `quantize_dynamic` with int8 weights, 38 utterances, 165 s of
audio.

|                                                     |         float32 |    int8 (MatMul + Conv) |
| --------------------------------------------------- | --------------: | ----------------------: |
| File size                                           |        21.39 MB |          8.12 MB (38 %) |
| Speed, onnxruntime-web wasm, one thread (Node)      | 21.9× real time |                   30.1× |
| Session creation                                    |         1017 ms |                  562 ms |
| Utterances whose durations are identical to float32 |     (reference) |                 2 of 38 |
| Change in utterance length                          |                 | 1.23 % mean, 2.51 % max |
| Log-spectral distance to float32                    |  6.30 dB (self) |                 7.67 dB |

**The add-on keeps float32.** int8 is 13 MB smaller and about 37 % faster, but its output is measurably different
speech (durations differ in 36 of 38 utterances) with no listening test behind it. Leaving the convolutions in
float32 does not help. To judge by ear, run the script and compare the WAV pairs in `.output/int8-experiment/`. If
size becomes a goal, upstream's block-scaled Q8 weights are the better route and would need a custom ONNX export.

## 12. Tooling

- `web-ext run` cannot start a snap-packaged Firefox: the snap cannot see the temporary profile. Point it at the
  binary inside the snap (`/snap/firefox/current/usr/lib/firefox/firefox`).
- Scripts run through `tsx`: a distribution's Node may lack built-in TypeScript stripping.
- WebDriver BiDi cannot open `moz-extension:` pages. The end-to-end tests drive Firefox through Marionette, whose
  clicks are real input events.
- Synthesized key presses do not reach Firefox's shortcut handling in headless mode. The tests trigger the registered
  shortcut's `<key>` element, which fails unless that exact shortcut is registered.
- `web-ext lint`: no errors, four accepted warnings. One is that `strict_min_version` 140 predates Firefox for
  Android 142 (the add-on is desktop only); three are inside ONNX Runtime and pdf.js.

## 13. Extra voices

Other models of the tiny-voca family can be downloaded from a list kept in the add-on
([engine/models.ts](../engine/models.ts)). The bundled model stays in every release.

**Which models**

- A model can be listed only if it works with the engine and the bundled English phonemizer unchanged: the same
  token table, the inputs and outputs of §1, 24 kHz. Text-to-phoneme code for another language would have to ship
  inside the add-on; it cannot be downloaded, because that would be remote code.
- A check on 2026-11-21 of the 34 community models linked from the tiny-voca README found two that qualify, both
  Apache-2.0 and both a 21 MB float32 ONNX file. Through `createEngine` under Node each gave finite audio and 14 word
  timings for a test sentence.

  | Model                     | Voices | Hugging Face revision                      | `onnx/model.onnx`                     |
  | ------------------------- | ------ | ------------------------------------------ | ------------------------------------- |
  | `PatnaikAshish/SobbieTTS` | F, M   | `6b6132c6d34b5fc163d8f5553580678a60532ac3` | 21,386,372 bytes, SHA-256 `eafb38b7…` |
  | `cfahlgren1/fiato`        | F1, M1 | `967de50b6a9ab673ef7de9f8f276fa93a8c0db81` | 21,388,682 bytes, SHA-256 `179df2e1…` |

- SobbieTTS has the original's token table. fiato has the same 76 tokens at the same ids plus three more (sigh,
  exhale, gasp) that the phonemizer never emits, so those sounds are not used.
- **`phonemizer.fingerprint` in a model's `config.json` cannot be trusted**: one model claimed the original's
  fingerprint with a different token table. Models are admitted by comparing the table itself.
- **Each list entry names the text front end it needs** (`frontend`), and the list in this repository is the
  authority for it, for the reason above. The engine sets up the front end by that name and refuses a model whose
  front end it does not have, before loading the file; the bundled model then reads, with the notice described
  below. The front ends there are, and the languages they brought, are in §14.
- What that leaves open for another language: a front end's **code** must ship in the add-on (no remote code), so a
  new language is a new release with its front end and list entries that name it. A front end's **data**, such as a
  pronunciation dictionary, is data like model weights and could be downloaded the same way. That is not built:
  the lexicons of §14 are in the package.
- The sizes and SHA-256 values are the ones Hugging Face publishes for the files
  (`https://huggingface.co/api/models/<repo>?blobs=true`); a download of SobbieTTS from Firefox hashed to the same.

**Is a download allowed?** Mozilla's Add-on Policies (last updated 2026-10-20) and the revision announced for
2026-12-01 say the same in "Development Practices": "Add-ons must be self-contained and not load remote code for
execution", and "Add-ons must use encryption when transporting data remotely." About other files: "If external
resources are used in combination with add-on code, the functionality of the code must not be obscured." Nothing
forbids fetching data. Model weights are data: ONNX Runtime, which is in the package, reads them, and no script or
wasm is fetched. The policy does not define "remote code", so a reviewer has the last word **(unverified: not
submitted yet)**. The request is `https`, started by a click, and described in the README.

**The request**

- `https://huggingface.co/<repo>/resolve/<revision>/onnx/model.onnx` answers `302` to a signed address on
  `us.aws.cdn.hf.co`. Both answers carry CORS headers, so **the download works from an add-on page with no host
  permission at all** (21 MB in 1.5 s on the test connection).
- **The permission is asked for anyway, because of one header.** Measured with a local server: without host access
  Firefox sends `Origin: moz-extension://<uuid>` on the first request, and that uuid is made up per installation,
  so it would tell one user's downloads apart. With host access to the first host there is no `Origin` header; the
  redirected request carries `Origin: null` either way. `credentials: "omit"` keeps cookies out. An end-to-end test
  checks that the request has no `Cookie`, `Authorization`, `Origin` or `Referer`.
- The access is requested in the click on Download and removed when that download ends, unless it was held before
  (granted earlier for a PDF on that site). Firefox's prompt reads "Access your data for sites in huggingface.co
  domains". Verified by clicking through the real prompt: accepted and refused in the settings page opened in a
  tab, and accepted where it is embedded in `about:addons`, with a real download from Hugging Face.
- **Not in the toolbar popup.** A popup closes when it loses focus, which a permission prompt causes, and a
  download would die with it. The popup offers the downloaded models and a link to the settings.

**Verifying and storing**

- A download is kept in memory, never more than the size the list pins, and stored only if its length and SHA-256
  match. Tested end to end with a file that has one byte changed: nothing is stored.
- **Storage: IndexedDB.** Tried with a throwaway add-on, writing 21 MB in a page and reading it elsewhere:

  | Storage                                 | Add-on page | Background page | Worker started by it |
  | --------------------------------------- | ----------- | --------------- | -------------------- |
  | IndexedDB, as a `Blob`                  | works       | works           | works, read in 36 ms |
  | IndexedDB, as an `ArrayBuffer`          | works       | works           | works                |
  | OPFS (`navigator.storage.getDirectory`) | works       | works           | works                |

  Both would do. IndexedDB was taken: the same few lines in the page and in the Worker, and a `Blob` is kept as a
  file by Firefox. `storage.local` is not meant for 21 MB values.
- `navigator.storage.persisted()` is false, so Firefox may evict the models when the disk is short. `unlimitedStorage`
  would prevent that and was not added: it is one more permission, and a model that is gone is handled.

**Using a model**

- The model's id travels with every request (`SynthOptions.model`). The Worker has no `browser.storage`, and this
  way a change of model needs no other message.
- Before a model is used, its inputs and outputs are compared with §1, by name and type
  (`InferenceSession.inputMetadata`). A stand-in model with one input renamed is refused.
- **Fallback.** A model that is not in storage, cannot be loaded, or needs a front end the build lacks is replaced by
  the bundled one, and every
  result made that way carries a notice that the control bar shows. A missing file is looked for again with each
  sentence (cheap), so a model downloaded again is used at once; a file that failed to load is not tried again
  until the Worker restarts. The settings form offers only models that are in storage, and deleting the chosen
  model chooses the bundled one.
- One model is in memory at a time; switching releases the session first. In Firefox, the test sentence came out as
  2.57 s of audio with SobbieTTS and 2.94 s with fiato, 9 word timings each.

**Testing.** No test file can pass for a listed model, since each is pinned to a hash. The end-to-end test
([tests/e2e/models.test.ts](../tests/e2e/models.test.ts)) therefore makes a second production build with one more
list entry, given in `VITE_E2E_MODEL`: a 687-byte ONNX file with the right inputs and outputs, written out by hand
([tests/stand-in-model.ts](../tests/stand-in-model.ts)) and served by the local test site. The normal build has no
trace of it.

## 14. Other languages

**Survey.** The 32 non-English models linked from the tiny-voca README (2026-11-21) were looked at: page, files,
licence, and where there is an ONNX file, its interface.

- **The models fit.** 19 ONNX files were run through the engine's input and output check and one synthesis: 17 have
  exactly the interface of §1, at 24 kHz, with `sum(durations) * 256 === samples`. The exceptions are an Austrian
  German model with an extra `accent` input and a Sanskrit one with `weight` in place of `stress`.
- **The front ends mostly do not.** A front end's code has to ship in the add-on, as dependency-free JavaScript with
  no `eval`. Most projects use the eSpeak NG program (GPL-3.0, natively or as wasm), Python under Pyodide, or a
  large helper model. Some have no licence, weights under a non-commercial licence, no ONNX file, or no published
  front end.
- Two had what is needed as they were and were added first; two more followed with eSpeak NG (below).

| Language             | Model                                   | Front end                                           | Its data in the package                                  |
| -------------------- | --------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Brazilian Portuguese | `semfence/tiny-voca-ptbr`, CC BY 4.0    | `SemFence/dizione-ptbr-js` at `8fbb77e`, Apache-2.0 | lexicon 0.9 MB (CC BY 4.0, from the MFA dictionary)      |
| Italian              | `OfficinePixel/vocina` v1.0, Apache-2.0 | vocina's `g2p_it.js` at `8dd17b3`, Apache-2.0       | 32 kB of rules, Wiktionary lexicon 0.5 MB (CC BY-SA 4.0) |

**What was checked for the two**

- **Against each project's own reference.** Italian: all of vocina's test vectors without optional readings give
  the Python reference's ids and stress, and the released model's symbol table gives the same ids. Portuguese: 333
  of the 341 sample sentences and edge cases agree, four of them texts with nothing to say. Seven that differ
  contain loanwords or spelled-out acronyms, whose pronunciation the port's last commit changed after the sample
  was recorded; one has accents stored as separate marks (below).
- **Through the engine**, with the real models under Node and in Firefox after a download through the settings
  page: finite audio (6.2 s for "Oi, tudo bem? Paguei R$ 15,50 às 10h30.", 3.1 s for "L'amico arriva alle 14:35,
  poi parte."), every source word timed, "R$ 15,50" and "14:35" as one span over their expansion.
- **Accents as separate marks.** Text from a PDF often stores "ã" as "a" and a combining mark. The Portuguese
  reference then reads "mãe" as "mai". The engine composes the text (NFC) before these two front ends, and the word
  alignment compares composed words.

**How a front end fits in**

- A front end is a function from text to token ids, stress and the token range of each spoken word
  (`loadFrontEnd` in [engine/frontends.ts](../engine/frontends.ts)). The Worker sets one up the first time a model
  names it and keeps it.
- **Word timing without help from the front end.** Neither new front end says which tokens belong to which word.
  Both put a pause token or a mark between words, so each run of phones is one spoken word. The words' texts are
  the words of the front end's own rewritten text ("15,50" already "quinze reais e cinquenta centavos"). When the
  two counts differ the words are dropped, and only the sentence is highlighted; over 95 % of the reference
  sentences get their words.
- The TypeScript front end is reached through an alias given to Vite alone, with hand-written types: `tsc` would
  otherwise check its sources against this repository's stricter settings.
- The reader follows the model's language: the bar's warning compares the detected language with the model's, and
  "only reads English" became "only reads" the model's language. Sentence splitting still uses the English
  abbreviation list for every language.
- Size: the package grew from 46.2 MB to 47.8 MB, almost all of it the two lexicons; the Worker script from 148 kB to
  175 kB.

**The Italian model is on GitHub Releases**, which sends no CORS headers on either hop. The download therefore
needs host access to `github.com` and to `release-assets.githubusercontent.com`, where it redirects; both are
requested in the one prompt and given back after the download, like `huggingface.co` (§13). If GitHub moves its
release files to another host the download will fail until the list is updated. A release tag can be moved, so the
SHA-256 is what pins the file.

**eSpeak NG.** Most community models were trained on phonemes from the eSpeak NG program. It is now part of the
add-on, as WebAssembly, and brought European Spanish (`marcosmaceo/tiny-voca-es`) and French
(`DanielSuncost/tiny-voca-fr`).

- **Licence.** eSpeak NG and its data are GPL-3.0-or-later, so Tiny Reader changed from Apache-2.0 to
  GPL-3.0-or-later before its first release. Everything else in the package can be carried under it (Apache-2.0,
  MIT, BSD; the two lexicons are data files under their own Creative Commons licences).
- **The build.** No npm package wraps a tagged eSpeak NG release verifiably, so
  [scripts/build-espeak.sh](../scripts/build-espeak.sh) builds tag 1.52.0 (commit `4870adf`) in an emscripten 4.0.10
  container pinned by digest, adapted from `stdevMac/tiny-voca`. It takes about a minute. Two builds on this machine
  were identical byte for byte, and the script refuses to install a build that differs from the recorded hashes
  (`scripts/espeak.sha256`; CI checks its cached copy against the same file). Shipped: 64 kB of loader
  (bundled into the Worker script), 362 kB of wasm, and 498 kB of data for Spanish, French and English.
- **In the add-on.** The loader has no `eval`, and the wasm runs in the engine Worker under the extension CSP
  (`'wasm-unsafe-eval'`, already there for ONNX Runtime). `web-ext lint` reports nothing new. Verified in Firefox:
  both models downloaded through the settings page and spoke.
- **Each language has its own code around eSpeak NG**: the model's own JavaScript port of tiny-voca's `text.py`
  (normalising, cutting at punctuation, mapping eSpeak's IPA to the model's tokens), fetched at a pinned commit.
- **Checked against each project's Python front end**, run with a native eSpeak NG built from the same source:
  identical ids and stress for all 50 Spanish and all 50 French sentences in
  [tests/parity/espeak-sentences.json](../tests/parity/espeak-sentences.json), and the models' symbol tables match.
- **The eSpeak NG version matters.** The Spanish model was trained with 1.52.0, the version built here. **The
  French model's version is not stated anywhere** in its repository; other projects measured 0.5 to 1.2 % of texts
  differing between 1.51 and 1.52. If it was 1.51, a few words are said with other phonemes than the model
  learned **(unverified)**.
- **Word timing.** eSpeak NG gives phonemes, not the words it read ("15" comes back as the sounds of "quince").
  For each piece of text between two marks, if eSpeak NG spoke as many words as the piece has between spaces, they
  are matched one for one; otherwise the piece is one span. In the reference sentences, which are heavy with
  numbers and dates, 79 % of the Spanish spoken words are matched to a word.
- **Other scripts.** Measured with the Spanish voice: eSpeak NG names the letters of Cyrillic, Arabic and Japanese
  text ("cirílico …", "árabe …", "japonés símbolo"), so these two front ends do not report "nothing to pronounce"
  for it. Greek and Devanagari come out empty: eSpeak NG switches to Greek or Hindi for them, whose dictionaries
  are not packed, so such words are skipped (a Greek word inside a Spanish sentence is left out, a Greek sentence
  is "nothing to pronounce"). The same holds for every script eSpeak NG reads through a language of its own. A
  full eSpeak NG, as the models were trained with, would read them in that language; packing every dictionary to
  match is tens of megabytes for text these models never learned. **Unverified:** what the models do with either.
- Size: the package is 48.7 MB, the Worker script 232 kB.

**German** (`apptor/apptor-tiny-tts`) needs no eSpeak NG: its makers trained a letter-to-sound model on eSpeak
NG's readings and wrote the front end in JavaScript.

- **A second downloaded file.** That model is 12.4 MB, too much to bundle for one language, and it is data. A list
  entry can therefore name a `helper`: pinned like the model, downloaded before it, and stored and deleted with it
  in one IndexedDB transaction each, so a download that fails or is interrupted leaves nothing behind. The Worker
  keeps the front end of the model loaded last and lets another one go: the letter-to-sound model is not held in
  memory beside a model that has no use for it.
- **A second session in the Worker**, and an asynchronous front end. The engine cuts long text with a synchronous
  test, so a piece not phonemized yet counts as short enough, is phonemized after the pass, and the cutting is
  repeated until nothing is new.
- **Checked against the Python front end** (`pnpm german-fixtures`, in a pinned Python container with onnxruntime
  1.32.0): identical ids and stress for all 50 sentences in
  [tests/parity/german-sentences.json](../tests/parity/german-sentences.json), though one side runs the
  letter-to-sound model natively and the other as wasm. Every spoken word is named, numbers included, because
  this front end reads word by word.
- In Firefox: both files downloaded through the settings page (stored as `apptor-de` and `apptor-de/helper`), and
  "Hallo, der Zug fährt um 14:35 Uhr ab." came out as 2.8 s with all eight words timed.
- **Not used: the Vocos sound filter.** The makers add a second stage (16.7 MB) that re-synthesises the audio and
  say that without it the voice is "noticeably buzzy". Tiny Reader plays the model's own output.
- The Austrian model of the same makers has one more input (`accent`) and is not in the list.

**What is left of the survey.** With eSpeak NG in the package, a model trained on its output needs its dictionary
in the build, its front-end code and a reference. Candidates, none of them done: Turkish (`erkint/zerre-tts`),
Bengali (`Xeven7/tiny-swara`) and Malayalam (`Cyrax321/tui-voice-mini-ml`) have only Python front ends (200 to 500
lines each to port, eSpeak NG versions not pinned); a second Italian and a second Brazilian Portuguese model were
trained on eSpeak NG 1.51, not the version built. Russian, Polish, Japanese, Arabic, Hebrew, Korean, Urdu, Greek,
Hindi, Swahili, Kurdish and Sanskrit stay out for the reasons at the top of this section.
