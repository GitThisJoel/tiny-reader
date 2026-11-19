// Runs the real model end to end under Node with onnxruntime-web (the wasm build that ships
// in the add-on) and checks the output is sane.
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createEngine,
	type Engine,
	MAX_TOKENS,
	NothingToPronounce,
} from "../../engine/engine.ts";
import {
	DEFAULT_OPTIONS,
	HOP,
	SAMPLE_RATE,
	VOICES,
} from "../../engine/protocol.ts";
import { readConfig, readGguf, readModel } from "../assets.ts";

let engine: Engine;
beforeAll(async () => {
	ort.env.wasm.numThreads = 1;
	engine = await createEngine(ort, {
		model: await readModel(),
		gguf: await readGguf(),
	});
}, 60_000);

const peakOf = (pcm: Float32Array) =>
	pcm.reduce((top, sample) => Math.max(top, Math.abs(sample)), 0);

describe("engine", () => {
	it("agrees with the model's config.json", async () => {
		const config = await readConfig();
		expect(config.sample_rate).toBe(SAMPLE_RATE);
		expect(config.hop).toBe(HOP);
		expect(config.voices).toEqual([...VOICES]);
		expect(config.model.max_tokens).toBeGreaterThanOrEqual(MAX_TOKENS);
	});

	it.each([0, 1])("speaks a sentence with voice %i", async (voice) => {
		const result = await engine.speak("Hello! This is tiny voca.", {
			...DEFAULT_OPTIONS,
			voice,
		});
		if (!result) throw new Error("no result");
		expect(result.sampleRate).toBe(24000);
		expect(result.pcm).toBeInstanceOf(Float32Array);
		expect(result.pcm.every(Number.isFinite)).toBe(true);
		const seconds = result.pcm.length / result.sampleRate;
		expect(seconds).toBeGreaterThan(1);
		expect(seconds).toBeLessThan(5);
		expect(result.pcm.length % HOP).toBe(0);
		const peak = peakOf(result.pcm);
		expect(peak).toBeGreaterThan(0.05);
		expect(peak).toBeLessThanOrEqual(0.99 + 1e-6);

		const text = "Hello! This is tiny voca.";
		expect(
			result.words.map((word) => text.slice(word.charStart, word.charEnd)),
		).toEqual(["Hello", "This", "is", "tiny", "voca"]);
		let previous = 0;
		for (const word of result.words) {
			expect(word.start).toBeGreaterThanOrEqual(previous);
			expect(word.end).toBeGreaterThan(word.start);
			previous = word.end;
		}
		expect(previous).toBeLessThanOrEqual(seconds);
	});

	it("speaks faster at a higher speed", async () => {
		const text = "The weather is nice today, and I feel very relaxed.";
		const normal = await engine.speak(text, DEFAULT_OPTIONS);
		const fast = await engine.speak(text, { ...DEFAULT_OPTIONS, speed: 2 });
		expect(fast?.pcm.length).toBeLessThan((normal?.pcm.length ?? 0) * 0.65);
	});

	it("splits a sentence that is too long for one call and joins the audio", async () => {
		const text = `${"the quick brown fox jumps over the lazy dog, ".repeat(12)}and stops.`;
		const result = await engine.speak(text, DEFAULT_OPTIONS);
		if (!result) throw new Error("no result");
		expect(result.pcm.length / result.sampleRate).toBeGreaterThan(20);
		expect(result.words.length).toBe(12 * 9 + 2);
		// Word positions stay correct across the pieces the sentence was cut into.
		expect(
			result.words
				.map((word) => text.slice(word.charStart, word.charEnd))
				.join(" "),
		).toBe(text.replace(/[,.]/g, ""));
		for (let index = 1; index < result.words.length; index++)
			expect(result.words[index]?.start).toBeGreaterThanOrEqual(
				result.words[index - 1]?.end ?? 0,
			);
		expect(result.words.at(-1)?.end).toBeLessThanOrEqual(
			result.pcm.length / result.sampleRate,
		);
		expect(peakOf(result.pcm)).toBeLessThanOrEqual(0.99 + 1e-6);
	}, 60_000);

	it("times an expanded number as one span over its source text", async () => {
		const text = "It costs $42.50 today.";
		const result = await engine.speak(text, DEFAULT_OPTIONS);
		if (!result) throw new Error("no result");
		expect(
			result.words.map((word) => text.slice(word.charStart, word.charEnd)),
		).toEqual(["It", "costs", "42.50", "today"]);
		const [, costs, amount, today] = result.words;
		// "forty two dollars and fifty cents" takes far longer than "costs".
		expect((amount?.end ?? 0) - (amount?.start ?? 0)).toBeGreaterThan(
			3 * ((costs?.end ?? 0) - (costs?.start ?? 0)),
		);
		expect(today?.start).toBeGreaterThanOrEqual(amount?.end ?? 0);
	});

	it("refuses text with nothing to pronounce", async () => {
		await expect(
			engine.speak("こんにちは世界", DEFAULT_OPTIONS),
		).rejects.toBeInstanceOf(NothingToPronounce);
	});

	it("returns null when aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		expect(
			await engine.speak("Hello there.", DEFAULT_OPTIONS, controller.signal),
		).toBeNull();
	});
});
