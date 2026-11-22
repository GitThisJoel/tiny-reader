# Third-party notices

Tiny Reader is licensed under the GNU General Public License, version 3 or later ([LICENSE](LICENSE),
[NOTICE](NOTICE)). The add-on package also
contains the components below, each under its own licence. Inside the add-on these three files are in `licenses/`, and
the licence texts that come with the model are in `assets/licenses/`.

| Component                                                                                                      | Version                                                        | Licence                                                                                     | In the add-on as                                                         | Source                                        |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| tiny-voca model                                                                                                | Hugging Face revision `1e73262`                                | Apache-2.0, © Muhammed Nazeem                                                               | `assets/model.onnx`                                                      | https://huggingface.co/n4ze3m/tiny-voca       |
| tiny-voca JavaScript phonemizer (dizione)                                                                      | GitHub commit `0eea2be`                                        | Apache-2.0, © Muhammed Nazeem                                                               | bundled into `engine-worker.js`                                          | https://github.com/n4ze3m/tiny-voca           |
| Phonemizer data, derived from the CMU Pronouncing Dictionary                                                   | Hugging Face revision `1e73262`                                | BSD-style, © Carnegie Mellon University                                                     | `assets/tiny-voca-js.gguf`                                               | https://huggingface.co/n4ze3m/tiny-voca       |
| Homograph data                                                                                                 | Hugging Face revision `1e73262`                                | Apache-2.0                                                                                  | `assets/tiny-voca-js.gguf`                                               | https://huggingface.co/n4ze3m/tiny-voca       |
| dizione-ptbr in TypeScript (Brazilian Portuguese front end)                                                    | GitHub commit `8fbb77e`                                        | Apache-2.0, © 2026 SemFence (Gustavo Toledo)                                                | bundled into `engine-worker.js`                                          | https://github.com/SemFence/dizione-ptbr-js   |
| Brazilian Portuguese lexicon, derived from the Portuguese (Brazil) MFA dictionary v2.0.0a                      | GitHub commit `8fbb77e`                                        | CC BY 4.0, Michael McAuliffe and Morgan Sonderegger; changes by SemFence (Gustavo Toledo)   | `assets/dizione-ptbr/lexicon.tsv`, `assets/dizione-ptbr/open_table.json` | https://github.com/SemFence/dizione-ptbr-js   |
| vocina `g2p_it` (Italian front end) and its data                                                               | GitHub commit `8dd17b3`                                        | Apache-2.0, OfficinePixel                                                                   | bundled into `engine-worker.js`, `assets/g2p-it/dati.json`               | https://github.com/OfficinePixel/vocina       |
| Italian pronunciation lexicon from the English Wiktionary                                                      | GitHub commit `8dd17b3`                                        | CC BY-SA 4.0, Wiktionary contributors, extracted with kaikki.org (wiktextract) and WikiPron | `assets/g2p-it/lessico_wikizionario.json`                                | https://github.com/OfficinePixel/vocina       |
| eSpeak NG, compiled to WebAssembly, with its data for Spanish, French, Turkish, Bengali, Malayalam and English | 1.52.0, commit `4870adf`                                       | GPL-3.0-or-later, © the eSpeak NG authors                                                   | `assets/espeak/`, and its loader bundled into `engine-worker.js`         | https://github.com/espeak-ng/espeak-ng        |
| eSpeak NG build script and loader, adapted                                                                     | GitHub commit `a4bf2bd`                                        | Apache-2.0, stdevMac                                                                        | the loader in `engine-worker.js`; the script builds `assets/espeak/`     | https://github.com/stdevMac/tiny-voca         |
| tiny-voca-es front end (European Spanish)                                                                      | GitHub commit `a4bf2bd`                                        | Apache-2.0, stdevMac                                                                        | bundled into `engine-worker.js`                                          | https://github.com/stdevMac/tiny-voca         |
| tiny-voca-fr front end (French)                                                                                | GitHub commit `4cc26ab`                                        | Apache-2.0, DanielSuncost                                                                   | bundled into `engine-worker.js`                                          | https://github.com/DanielSuncost/tiny-voca-fr |
| apptor-tiny-tts front end (German, and German with an Austrian accent) and its tables                          | Hugging Face revision `e28eb44` of `apptor/apptor-tiny-tts-at` | Apache-2.0, apptor                                                                          | bundled into `engine-worker.js`, `assets/g2p-de/`                        | https://huggingface.co/apptor/apptor-tiny-tts |
| tiny-voca `text.py`, ported to TypeScript (`engine/espeak-text.ts`)                                            | as in the projects below                                       | Apache-2.0, © Muhammed Nazeem and the projects below                                        | bundled into `engine-worker.js`                                          | https://github.com/n4ze3m/tiny-voca           |
| zerre-tts language pack for Turkish (tables and clean-up rules, ported)                                        | GitHub commit `cf3cdfa`                                        | Apache-2.0, erkinemreta1                                                                    | bundled into `engine-worker.js`                                          | https://github.com/erkinemreta1/zerre-tts     |
| tiny-swara inventory and English word list for Bengali                                                         | Hugging Face revision `9432a34`                                | Apache-2.0, Xeven7                                                                          | bundled into `engine-worker.js`                                          | https://huggingface.co/Xeven7/tiny-swara      |
| tui-voice front end for Malayalam (ported) and its table of token slots                                        | GitHub commit `478761a`, Hugging Face revision `9c2fee7`       | Apache-2.0 as its README states, Cyrax321                                                   | bundled into `engine-worker.js`                                          | https://github.com/Cyrax321/tui-voice         |
| ONNX Runtime Web                                                                                               | 1.31.1                                                         | MIT, © Microsoft Corporation                                                                | `ort/`, and bundled into `engine-worker.js`                              | https://github.com/microsoft/onnxruntime      |
| pdf.js (`pdfjs-dist`)                                                                                          | 6.5.438                                                        | Apache-2.0, © Mozilla Foundation                                                            | bundled into the document page, and `assets/pdf.worker.min-*.mjs`        | https://github.com/mozilla/pdf.js             |
| WXT runtime helpers                                                                                            | 0.21.5                                                         | MIT, © 2023 Aaron                                                                           | a few lines in each script                                               | https://github.com/wxt-dev/wxt                |

All of these are used unmodified; the eSpeak NG loader and build script are adapted, and the
Turkish, Bengali and Malayalam front ends are ports from Python, as their files say. The text-layer rules in `entrypoints/document/style.css` are taken from pdf.js's
`pdf_viewer.css`.

## Licence texts

- **GNU General Public License 3** (eSpeak NG): the same text as [LICENSE](LICENSE); eSpeak NG's own copy is
  `assets/licenses/espeak-ng.COPYING.txt`. eSpeak NG is built from its unmodified source at tag 1.52.0 by
  [scripts/build-espeak.sh](scripts/build-espeak.sh), with a small driver that is in that script.
- **Apache License 2.0** (tiny-voca, homograph data, dizione-ptbr, vocina, the Spanish, French and German front ends,
  the eSpeak NG loader, pdf.js): the copies that come with the model are in `assets/licenses/tiny-voca.LICENSE.txt` and
  `assets/licenses/homograph-data.LICENSE.txt`; the text is also at https://www.apache.org/licenses/LICENSE-2.0.
- **CMU Pronouncing Dictionary**: `assets/licenses/cmudict.LICENSE.txt`.
- **dizione-ptbr**: its notice is `assets/licenses/dizione-ptbr.NOTICE.txt`. The lexicon's licence and the changes
  made to the MFA dictionary are in `assets/licenses/dizione-ptbr-lexicon.LICENSE.md`; the text of CC BY 4.0 is at
  https://creativecommons.org/licenses/by/4.0/legalcode.
- **vocina**: its notice, which lists what it changed in tiny-voca and credits the Wiktionary lexicon, is
  `assets/licenses/vocina.NOTICE.txt`. The lexicon stays under CC BY-SA 4.0, whose text is at
  https://creativecommons.org/licenses/by-sa/4.0/legalcode; the rest of the add-on is not under that licence.
- **ONNX Runtime**: the MIT License below. Its WebAssembly binary contains further libraries, listed in
  `ThirdPartyNotices.txt` in its repository.
- **WXT**: the MIT License below, with "Copyright (c) 2023 Aaron" in place of Microsoft's line.

### MIT License (ONNX Runtime)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
