// The engine inside the real add-on: background event page → Worker → ONNX Runtime wasm,
// under the add-on's CSP, driven from the test page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";

let firefox: Firefox;
let page: string;
beforeAll(async () => {
	firefox = await Firefox.launch();
	page = await firefox.open(`${ADDON_URL}/playground.html`);
}, 60_000);
afterAll(() => firefox?.close());

const status = () =>
	firefox.waitFor<string>(
		page,
		`const text = document.getElementById("status").textContent;
		 return /^(Playing|Error|Stopped)/.test(text) ? text : null;`,
	);
const speak = async (text: string) => {
	await firefox.evaluate(
		page,
		`document.getElementById("text").value = arguments[0];
		 document.getElementById("status").textContent = "";`,
		[text],
	);
	await firefox.click(page, "button[type=submit]");
};

describe("playground", () => {
	it("synthesizes and plays a typed sentence", async () => {
		await speak("Hello! This is tiny voca.");
		const text = await status();
		expect(text).toMatch(
			/^Playing \d\.\d\d s of audio, made in \d+ ms\. 5 words\.$/,
		);
		const seconds = Number(/Playing ([\d.]+) s/.exec(text)?.[1]);
		expect(seconds).toBeGreaterThan(1);
		expect(seconds).toBeLessThan(5);
	}, 60_000);

	it("reports text it cannot read", async () => {
		await speak("こんにちは世界");
		expect(await status()).toMatch(/^Error: Nothing to pronounce/);
	}, 30_000);

	it("stops cleanly while synthesizing and speaks again afterwards", async () => {
		await speak(
			`${"the quick brown fox jumps over the lazy dog, ".repeat(20)}and stops.`,
		);
		await firefox.click(page, "#stop");
		expect(await status()).toBe("Stopped.");
		await speak("Still working.");
		expect(await status()).toMatch(/^Playing .* 2 words\.$/);
	}, 60_000);
});
