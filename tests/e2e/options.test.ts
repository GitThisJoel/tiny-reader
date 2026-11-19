// Settings, keyboard shortcuts and "read from here", in the real add-on.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_URL, Firefox } from "./firefox.ts";
import { startSite } from "./site.ts";

let firefox: Firefox;
let site: Awaited<ReturnType<typeof startSite>>;
let tab: string;
beforeAll(async () => {
	site = await startSite();
	firefox = await Firefox.launch();
	tab = await firefox.open(site.url);
}, 60_000);
afterAll(async () => {
	await firefox?.close();
	site?.close();
});

const BAR = `
	const root = document.querySelector("tiny-reader-bar")?.openOrClosedShadowRoot;
	if (!root) return null;
	return {
		status: root.querySelector("[role=toolbar]").dataset.status,
		text: root.querySelector("[role=status]").textContent,
		speed: root.querySelector('select[aria-label="Speed"]').value,
		voice: root.querySelector('select[aria-label="Voice"]').value,
	};`;
interface Bar {
	status: string;
	text: string;
	speed: string;
	voice: string;
}
const barWhen = (condition: string) =>
	firefox.waitFor<Bar>(
		tab,
		`const bar = (() => { ${BAR} })(); return bar && (${condition}) ? bar : null;`,
		30_000,
		true,
	);
const noBar = () =>
	firefox.waitFor(
		tab,
		`return !document.querySelector("tiny-reader-bar");`,
		10_000,
	);
const select = (selector: string) =>
	firefox.evaluate(
		tab,
		"getSelection().selectAllChildren(document.querySelector(arguments[0]));",
		[selector],
	);
const SENTENCE = `
	const [range] = CSS.highlights.get("tiny-reader-sentence") ?? [];
	return range ? range.toString().replace(/\\s+/g, " ") : null;`;

describe("options page", () => {
	it("saves settings and shows them again after a reload", async () => {
		const options = await firefox.open(`${ADDON_URL}/options.html`);
		const set = (name: string, value: string) =>
			firefox.evaluate(
				options,
				`const field = document.getElementById("form").elements[arguments[0]];
				 field.value = arguments[1];
				 field.dispatchEvent(new Event("input", { bubbles: true }));
				 field.dispatchEvent(new Event("change", { bubbles: true }));`,
				[name, value],
			);
		const values = () =>
			firefox.evaluate<Record<string, string>>(
				options,
				`const form = document.getElementById("form");
				 return Object.fromEntries(["voice", "speed", "pitchShift", "pitchRange", "prefetch"].map((name) => [name, form.elements[name].value]));`,
			);
		expect(await values()).toEqual({
			voice: "0",
			speed: "1",
			pitchShift: "0",
			pitchRange: "1",
			prefetch: "2",
		});
		await set("voice", "1");
		await set("speed", "1.5");
		await set("pitchShift", "-2");
		await set("prefetch", "99"); // clamped
		await firefox.waitFor(
			options,
			`return document.getElementById("saved").textContent.startsWith("Saved");`,
		);
		expect(
			await firefox.evaluate(
				options,
				`return document.querySelector('output[for="pitchShift"]').value;`,
			),
		).toBe("-2 st");
		await firefox.reload(options);
		await firefox.waitFor(
			options,
			`return document.getElementById("form")?.elements.voice.value === "1";`,
		);
		expect(await values()).toEqual({
			voice: "1",
			speed: "1.5",
			pitchShift: "-2",
			pitchRange: "1",
			prefetch: "5",
		});
		// Every control has a label.
		expect(
			await firefox.evaluate(
				options,
				`return [...document.querySelectorAll("select, input")].every((control) => control.labels.length > 0);`,
			),
		).toBe(true);
	}, 60_000);
});

describe("keyboard shortcuts", () => {
	it("Alt+Shift+R reads the selection with the saved settings", async () => {
		// A user has clicked or typed in the page before reaching for a shortcut.
		await firefox.click(tab, "#title");
		await select("#second");
		await firefox.shortcut(tab, "Alt+Shift+R");
		const bar = await barWhen(
			`bar.status === "playing" || bar.status === "blocked"`,
		);
		expect(bar).toMatchObject({
			status: "playing",
			text: "Sentence 1 of 3",
			speed: "1.5",
			voice: "1",
		});
	}, 60_000);

	it("Alt+Shift+P pauses and resumes; Alt+Shift+X stops", async () => {
		await firefox.shortcut(tab, "Alt+Shift+P");
		await barWhen(`bar.status === "paused"`);
		await firefox.shortcut(tab, "Alt+Shift+P");
		await barWhen(`bar.status === "playing"`);
		await firefox.shortcut(tab, "Alt+Shift+X");
		await noBar();
	}, 60_000);

	it("does nothing without a selection", async () => {
		await firefox.evaluate(tab, "getSelection().removeAllRanges();");
		await firefox.shortcut(tab, "Alt+Shift+R");
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(
			await firefox.evaluate(
				tab,
				`return !!document.querySelector("tiny-reader-bar");`,
			),
		).toBe(false);
	}, 30_000);
});

describe("read from here", () => {
	it("starts at the paragraph that was right-clicked and continues to the end of the page", async () => {
		await firefox.contextMenu(
			tab,
			"#first em",
			"Read from here with tiny-voca",
		);
		const bar = await barWhen(`bar.status === "playing"`);
		// Three sentences in #first, three in #second, one (unreadable) in #foreign.
		expect(bar.text).toBe("Sentence 1 of 7");
		expect(await firefox.evaluate(tab, SENTENCE)).toBe(
			"The quick brown fox jumps over the lazy dog.",
		);
	}, 60_000);

	it("a setting changed in the bar is used at once and remembered", async () => {
		await firefox.evaluate(
			tab,
			`const speed = document.querySelector("tiny-reader-bar").openOrClosedShadowRoot.querySelector('select[aria-label="Speed"]');
			 speed.value = "2";
			 speed.dispatchEvent(new Event("change"));`,
			[],
			true,
		);
		await barWhen(`bar.status === "playing" && bar.speed === "2"`);
		await firefox.shortcut(tab, "Alt+Shift+X");
		await noBar();
		await select("#second");
		await firefox.shortcut(tab, "Alt+Shift+R");
		expect((await barWhen(`bar.status === "playing"`)).speed).toBe("2");
		await firefox.shortcut(tab, "Alt+Shift+X");
		await noBar();
	}, 60_000);
});
