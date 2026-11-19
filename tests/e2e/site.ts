// A local web site for the end-to-end tests: a plain page and one with a strict CSP.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Test page</title>
<h1 id="title">A short story</h1>
<p id="first">The quick brown fox jumps over the lazy dog. It was a <a href="#">sunny</a> day, and
<em>nobody</em> minded.<br>A new line starts here!</p>
<p id="second">Second paragraph. <span hidden>Hidden words.</span> It has 3 sentences. Bye.</p>
<p id="foreign">こんにちは世界</p>
</html>`;

/** Blocks everything a page CSP can block. The add-on must work regardless. */
const STRICT_CSP =
	"default-src 'none'; script-src 'none'; style-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; connect-src 'none'";

export async function startSite(): Promise<{
	url: string;
	strictUrl: string;
	close(): void;
}> {
	const server: Server = createServer((request, response) => {
		const headers: Record<string, string> = {
			"content-type": "text/html; charset=utf-8",
		};
		if (request.url?.startsWith("/strict"))
			headers["content-security-policy"] = STRICT_CSP;
		response.writeHead(200, headers).end(PAGE);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/`,
		strictUrl: `http://127.0.0.1:${port}/strict`,
		close: () => server.close(),
	};
}
