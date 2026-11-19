import { describe, expect, it } from "vitest";
import { alignWords, type TimedWord, wordAt } from "./align.ts";

/** Spoken words, one second each. */
const said = (...words: string[]): TimedWord[] =>
	words.map((text, index) => ({ text, start: index, end: index + 1 }));
/** [source text, start, end] for each timing. */
const aligned = (text: string, spoken: TimedWord[]) =>
	alignWords(text, spoken).map((timing) => [
		text.slice(timing.charStart, timing.charEnd),
		timing.start,
		timing.end,
	]);

describe("alignWords", () => {
	it("pairs plain words one to one, ignoring case and punctuation", () => {
		expect(
			aligned(
				"Hello! This is tiny voca.",
				said("hello", "this", "is", "tiny", "voca"),
			),
		).toEqual([
			["Hello", 0, 1],
			["This", 1, 2],
			["is", 2, 3],
			["tiny", 3, 4],
			["voca", 4, 5],
		]);
	});

	it("gives an expanded number the whole time of its spoken words", () => {
		const text = "It costs $42.50 today.";
		const spoken = said(
			"it",
			"costs",
			"forty",
			"two",
			"dollars",
			"and",
			"fifty",
			"cents",
			"today",
		);
		expect(aligned(text, spoken)).toEqual([
			["It", 0, 1],
			["costs", 1, 2],
			["42.50", 2, 8],
			["today", 8, 9],
		]);
	});

	it("handles an expansion at the start and at the end", () => {
		expect(
			aligned(
				"Dr. Smith paid $5",
				said("doctor", "smith", "paid", "five", "dollars"),
			),
		).toEqual([
			["Dr", 0, 1],
			["Smith", 1, 2],
			["paid", 2, 3],
			["5", 3, 5],
		]);
	});

	it("treats several unmatched source words between anchors as one span", () => {
		expect(
			aligned(
				"Call 555 0147 now",
				said(
					"call",
					"five",
					"five",
					"five",
					"oh",
					"one",
					"four",
					"seven",
					"now",
				),
			),
		).toEqual([
			["Call", 0, 1],
			["555 0147", 1, 8],
			["now", 8, 9],
		]);
	});

	it("gives no timing to source words that were not spoken", () => {
		expect(aligned("yes (sic) no", said("yes", "no"))).toEqual([
			["yes", 0, 1],
			["no", 1, 2],
		]);
	});

	it("leaves spoken words with no source word untimed", () => {
		expect(aligned("a b", said("a", "extra", "b"))).toEqual([
			["a", 0, 1],
			["b", 2, 3],
		]);
	});

	it("matches curly apostrophes to straight ones", () => {
		expect(aligned("It’s fine", said("it's", "fine"))).toEqual([
			["It’s", 0, 1],
			["fine", 1, 2],
		]);
	});

	it("keeps repeated words in order", () => {
		const result = alignWords(
			"the cat and the dog and the bird",
			said("the", "cat", "and", "the", "dog", "and", "the", "bird"),
		);
		expect(result.map((timing) => timing.charStart)).toEqual([
			0, 4, 8, 12, 16, 20, 24, 28,
		]);
		expect(result.map((timing) => timing.start)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7,
		]);
	});

	it("returns timings in order of time and of position", () => {
		const result = alignWords(
			"On 3/4/2024 at 5pm, Dr. Who left.",
			said(
				"on",
				"march",
				"fourth",
				"twenty",
				"twenty",
				"four",
				"at",
				"five",
				"pm",
				"doctor",
				"who",
				"left",
			),
		);
		for (let k = 1; k < result.length; k++) {
			expect(result[k]?.start).toBeGreaterThanOrEqual(result[k - 1]?.end ?? 0);
			expect(result[k]?.charStart).toBeGreaterThanOrEqual(
				result[k - 1]?.charEnd ?? 0,
			);
		}
	});

	it("copes with nothing on either side", () => {
		expect(alignWords("", said("a"))).toEqual([]);
		expect(alignWords("a b", [])).toEqual([]);
		expect(alignWords("…", [])).toEqual([]);
	});
});

describe("wordAt", () => {
	const timings = alignWords("one two", [
		{ text: "one", start: 0.3, end: 0.6 },
		{ text: "two", start: 0.9, end: 1.2 },
	]);

	it("is null before the first word", () => {
		expect(wordAt(timings, 0.1)).toBeNull();
	});

	it("is the word being spoken", () => {
		expect(wordAt(timings, 0.3)?.charStart).toBe(0);
		expect(wordAt(timings, 1)?.charStart).toBe(4);
	});

	it("stays on a word through the pause after it", () => {
		expect(wordAt(timings, 0.75)?.charStart).toBe(0);
		expect(wordAt(timings, 5)?.charStart).toBe(4);
	});
});
