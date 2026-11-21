// A local web site for the end-to-end tests: a plain page, one with a strict CSP, PDFs, and a
// stand-in voice model to download.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { standInModel } from "../stand-in-model.ts";
import { buildPdf } from "./pdf.ts";

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Test page</title>
<article>
<h1 id="title">A short story</h1>
<p id="first">The quick brown fox jumps over the lazy dog. It was a <a href="#">sunny</a> day, and
<em>nobody</em> minded.<br>A new line starts here!</p>
<p id="second">Second paragraph. <span hidden>Hidden words.</span> It has 3 sentences. Bye.</p>
<p id="foreign">こんにちは世界</p>
</article>
<p id="french">Le gouvernement a annoncé hier de nouvelles mesures pour soutenir les petites entreprises. Les
habitants de la région attendent depuis longtemps une amélioration des transports publics. Selon le maire, les
travaux devraient commencer au printemps prochain et durer environ deux ans.</p>
<p id="runon">${"the river kept on running past the old mill and under the stone bridge and through the quiet town ".repeat(30)}until it reached the sea</p>
<p id="empty"><img alt=""> — … —</p>
</html>`;

/** Served for any address ending in .pdf. Firefox shows it in its own PDF viewer. */
const SAMPLE_PDF = buildPdf([
  [
    ["A sample document", 720, 20],
    ["This file exists to be shown in the PDF viewer of the browser.", 680],
  ],
]);

/** Blocks everything a page CSP can block. The add-on must work regardless. */
const STRICT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; connect-src 'none'";

/** An article of `paragraphs` paragraphs, each with inline markup, a link and three sentences. */
const longPage = (paragraphs: number) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Long page</title>
<article>
<h1 id="title">A very long article</h1>
${Array.from(
  { length: paragraphs },
  (_, index) =>
    `<p id="p${index}">Paragraph ${index + 1} begins <em>here</em>. It links to <a href="#">another page</a> and goes on a little. Then it ends.</p>`,
).join("\n")}
</article>
</html>`;

/** Served at /stand-in.onnx, as Hugging Face serves a model: to any origin. */
export const STAND_IN = standInModel();

export async function startSite(): Promise<{
  url: string;
  strictUrl: string;
  /** The headers of every request for the stand-in model. */
  modelRequests: IncomingHttpHeaders[];
  /** While true, the stand-in model is served with one byte changed. */
  tamper: boolean;
  close(): void;
}> {
  const modelRequests: IncomingHttpHeaders[] = [];
  const server: Server = createServer((request, response) => {
    if (request.url === "/stand-in.onnx") {
      modelRequests.push(request.headers);
      const file = Uint8Array.from(STAND_IN);
      if (site.tamper) file[file.length - 1] = (file.at(-1) ?? 0) ^ 1;
      response
        .writeHead(200, { "content-type": "application/octet-stream", "access-control-allow-origin": "*" })
        .end(file);
      return;
    }
    const headers: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
    };
    if (request.url?.startsWith("/strict")) headers["content-security-policy"] = STRICT_CSP;
    if (request.url?.includes("status=404")) {
      response.writeHead(404).end("not here");
      return;
    }
    // Like arxiv.org/pdf/1706.03762: a PDF whose address does not say so. The name comes in a header.
    if (request.url?.startsWith("/pdf/")) {
      response
        .writeHead(200, { "content-type": "application/pdf", "content-disposition": 'inline; filename="paper-v7.pdf"' })
        .end(SAMPLE_PDF);
      return;
    }
    if (request.url?.endsWith(".pdf")) {
      response.writeHead(200, { "content-type": "application/pdf" }).end(SAMPLE_PDF);
      return;
    }
    const long = /^\/long\/(\d+)/.exec(request.url ?? "");
    response.writeHead(200, headers).end(long ? longPage(Number(long[1])) : PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const site = {
    url: `http://127.0.0.1:${port}/`,
    strictUrl: `http://127.0.0.1:${port}/strict`,
    modelRequests,
    tamper: false,
    close: () => server.close(),
  };
  return site;
}
