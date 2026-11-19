// Reads a PDF's text with pdf.js. The file never leaves the page: it is parsed here, in a Worker.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { paragraphsOf, type TextItem } from "@/content/pdf-text.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(data: ArrayBuffer, onPage: (page: number, pages: number) => void): Promise<string[]> {
  // Text only, and nothing fetched: no font loading, no wasm image decoders, no extra data files.
  const loading = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await loading.promise;
  try {
    const pages: TextItem[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      onPage(number, document.numPages);
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          "str" in item
            ? [{ str: item.str, x: item.transform[4], y: item.transform[5], height: item.height, hasEOL: item.hasEOL }]
            : [],
        ),
      );
    }
    return paragraphsOf(pages);
  } finally {
    await loading.destroy();
  }
}
