// Reading a web page: select text, pick "Read with tiny-voca" from the context menu, and
// follow the control bar. Run on a plain page and on one with a strict Content-Security-Policy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
beforeAll(async () => {
	site = await startSite();
	firefox = await Firefox.launch();
}, 60_000);
afterAll(async () => {
	await firefox?.close();
	site?.close();
});

const MENU = "Read with tiny-voca";
/** What the control bar shows; null when there is no bar. Looks into the closed shadow root. */
const BAR = `
	const host = document.querySelector("tiny-reader-bar");
	const root = host?.openOrClosedShadowRoot;
	if (!root) return null;
	const toolbar = root.querySelector("[role=toolbar]");
	return {
		status: toolbar.dataset.status,
		text: root.querySelector("[role=status]").textContent,
		toggle: root.querySelectorAll("button")[1].getAttribute("aria-label"),
		background: getComputedStyle(toolbar).borderRadius,
		position: getComputedStyle(host).position,
	};`;
interface Bar {
	status: string;
	text: string;
	toggle: string;
	background: string;
	position: string;
}
const bar = (tab: string) => firefox.evaluate<Bar | null>(tab, BAR, [], true);
const barWhen = (tab: string, condition: string, timeout = 30_000) =>
	firefox.waitFor<Bar>(
		tab,
		`const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
		timeout,
		true,
	);
const press = (tab: string, label: string) =>
	firefox.evaluate(
		tab,
		`document.querySelector("tiny-reader-bar").openOrClosedShadowRoot
			.querySelector('button[aria-label="' + arguments[0] + '"]').click();`,
		[label],
		true,
	);
const select = (tab: string, selector: string) =>
	firefox.evaluate(
		tab,
		"getSelection().selectAllChildren(document.querySelector(arguments[0]));",
		[selector],
	);

describe.each([
	["a plain page", () => site.url],
	["a page with a strict CSP", () => site.strictUrl],
])("reading on %s", (_, url) => {
	let tab: string;
	beforeAll(async () => {
		tab = await firefox.open(url());
	});

	it("reads the selection and plays without needing a click", async () => {
		await select(tab, "#second");
		await firefox.contextMenu(tab, "#second", MENU);
		const playing = await barWhen(tab, `bar.status === "playing"`);
		// Three sentences: the hidden span is not part of the selection text.
		expect(playing.text).toBe("Sentence 1 of 3");
		expect(playing.toggle).toBe("Pause");
		// The bar's stylesheet applies even where the page forbids styles.
		expect(playing.position).toBe("fixed");
		expect(playing.background).toBe("10px");
	}, 60_000);

	it("pauses, resumes and skips", async () => {
		await press(tab, "Pause");
		expect(await barWhen(tab, `bar.status === "paused"`)).toMatchObject({
			text: "Paused. Sentence 1 of 3",
			toggle: "Play",
		});
		await press(tab, "Play");
		await barWhen(tab, `bar.status === "playing"`);
		await press(tab, "Next sentence");
		expect(
			(
				await barWhen(
					tab,
					`bar.status === "playing" && bar.text.includes(" 2 ")`,
				)
			).text,
		).toBe("Sentence 2 of 3");
		await press(tab, "Previous sentence");
		expect(
			(
				await barWhen(
					tab,
					`bar.status === "playing" && bar.text.includes(" 1 ")`,
				)
			).text,
		).toBe("Sentence 1 of 3");
	}, 60_000);

	it("plays through to the end and removes the bar", async () => {
		await press(tab, "Next sentence");
		await press(tab, "Next sentence");
		await barWhen(tab, `bar.text === "Sentence 3 of 3"`);
		await firefox.waitFor(
			tab,
			`return !document.querySelector("tiny-reader-bar");`,
			20_000,
		);
	}, 60_000);

	it("stop removes the bar at once and leaves the page as it was", async () => {
		await select(tab, "#first");
		await firefox.contextMenu(tab, "#first", MENU);
		await barWhen(tab, `bar.status === "playing"`);
		await press(tab, "Stop reading");
		expect(await bar(tab)).toBeNull();
		expect(
			await firefox.evaluate(
				tab,
				"return document.documentElement.childElementCount;",
			),
		).toBe(2);
	}, 60_000);

	it("explains when the selection has nothing it can read", async () => {
		await select(tab, "#foreign");
		await firefox.contextMenu(tab, "#foreign", MENU);
		const failed = await barWhen(tab, `bar.status === "error"`);
		expect(failed.text).toMatch(/only reads English/);
		await press(tab, "Stop reading");
	}, 60_000);
});
