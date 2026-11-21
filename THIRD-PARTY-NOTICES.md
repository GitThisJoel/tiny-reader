# Third-party notices

Tiny Reader is licensed under the Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). The add-on package also
contains the components below, each under its own licence. Inside the add-on these three files are in `licenses/`, and
the licence texts that come with the model are in `assets/licenses/`.

| Component                                                    | Version                         | Licence                                 | In the add-on as                                                  | Source                                   |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| tiny-voca model                                              | Hugging Face revision `1e73262` | Apache-2.0, © Muhammed Nazeem           | `assets/model.onnx`                                               | https://huggingface.co/n4ze3m/tiny-voca  |
| tiny-voca JavaScript phonemizer (dizione)                    | GitHub commit `0eea2be`         | Apache-2.0, © Muhammed Nazeem           | bundled into `engine-worker.js`                                   | https://github.com/n4ze3m/tiny-voca      |
| Phonemizer data, derived from the CMU Pronouncing Dictionary | Hugging Face revision `1e73262` | BSD-style, © Carnegie Mellon University | `assets/tiny-voca-js.gguf`                                        | https://huggingface.co/n4ze3m/tiny-voca  |
| Homograph data                                               | Hugging Face revision `1e73262` | Apache-2.0                              | `assets/tiny-voca-js.gguf`                                        | https://huggingface.co/n4ze3m/tiny-voca  |
| ONNX Runtime Web                                             | 1.31.1                          | MIT, © Microsoft Corporation            | `ort/`, and bundled into `engine-worker.js`                       | https://github.com/microsoft/onnxruntime |
| pdf.js (`pdfjs-dist`)                                        | 6.5.438                         | Apache-2.0, © Mozilla Foundation        | bundled into the document page, and `assets/pdf.worker.min-*.mjs` | https://github.com/mozilla/pdf.js        |
| WXT runtime helpers                                          | 0.21.5                          | MIT                                     | a few lines in each script                                        | https://github.com/wxt-dev/wxt           |

All of these are used unmodified. The text-layer rules in `entrypoints/document/style.css` are taken from pdf.js's
`pdf_viewer.css`.

## Licence texts

- **Apache License 2.0** (tiny-voca, homograph data, pdf.js): the same text as [LICENSE](LICENSE). The copies that come
  with the model are in `assets/licenses/tiny-voca.LICENSE.txt` and `assets/licenses/homograph-data.LICENSE.txt`.
- **CMU Pronouncing Dictionary**: `assets/licenses/cmudict.LICENSE.txt`.
- **ONNX Runtime**: the MIT License below. Its WebAssembly binary contains further libraries, listed in
  `ThirdPartyNotices.txt` in its repository.
- **WXT**: the MIT License below, with the copyright notice of the WXT authors in place of Microsoft's.

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
