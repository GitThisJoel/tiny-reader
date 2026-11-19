import { beforeAll, describe, expect, it } from "vitest";
import { testPhonemizer } from "../tests/assets.ts";
import fixtures from "../tests/parity/fixtures.json" with { type: "json" };
import { type Phonemizer, phonemize } from "./phonemizer.ts";

let phonemizer: Phonemizer;
beforeAll(async () => {
	phonemizer = await testPhonemizer();
});

describe("phonemize", () => {
	it("matches upstream's own phonemize() on every fixture sentence", () => {
		for (const { text } of fixtures.cases) {
			const ours = phonemize(phonemizer, text);
			if (!ours) {
				expect(() => phonemizer.phonemize(text), text).toThrow();
				continue;
			}
			const theirs = phonemizer.phonemize(text);
			expect(ours.ids, text).toEqual(theirs.ids);
			expect(ours.stress, text).toEqual(theirs.stress);
		}
	});

	it("returns null when there is nothing to pronounce", () => {
		expect(phonemize(phonemizer, "")).toBeNull();
		expect(phonemize(phonemizer, "   ")).toBeNull();
		expect(phonemize(phonemizer, "こんにちは世界")).toBeNull();
	});

	it("gives every spoken word its token range", () => {
		const result = phonemize(phonemizer, "Hello! This is tiny voca.");
		expect(result?.words.map((word) => word.text)).toEqual([
			"hello",
			"this",
			"is",
			"tiny",
			"voca",
		]);
		// <bos> h ə l oʊ ! ð ɪ s <sp> ɪ z <sp> t aɪ n i <sp> v oʊ k ə . <eos>
		expect(
			result?.words.map((word) => [word.tokenStart, word.tokenEnd]),
		).toEqual([
			[1, 5],
			[6, 9],
			[10, 12],
			[13, 17],
			[18, 22],
		]);
	});

	it("covers exactly the phone tokens, in order, on every fixture sentence", () => {
		const symbolOf = (id: number) => id; // ids 0..16 are specials and punctuation
		for (const { text } of fixtures.cases) {
			const result = phonemize(phonemizer, text);
			if (!result) continue;
			expect(result.words.length, text).toBeGreaterThan(0);
			const owned = new Set<number>();
			let previousEnd = 0;
			for (const word of result.words) {
				expect(word.tokenStart, text).toBeGreaterThanOrEqual(previousEnd);
				expect(word.tokenEnd, text).toBeGreaterThan(word.tokenStart);
				for (let token = word.tokenStart; token < word.tokenEnd; token++)
					owned.add(token);
				previousEnd = word.tokenEnd;
			}
			result.ids.forEach((id, token) => {
				// <unk> (4) stands for a phone the model lacks; it still belongs to a word.
				const spoken = symbolOf(id) > 16 || id === 4;
				expect(owned.has(token), `${text} @${token}`).toBe(spoken);
			});
		}
	});
});
