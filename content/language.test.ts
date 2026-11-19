import { describe, expect, it } from "vitest";
import { languageWarning } from "./language.ts";

const detected = (isReliable: boolean, ...languages: [string, number][]) => ({
	isReliable,
	languages: languages.map(([language, percentage]) => ({
		language,
		percentage,
	})),
});

describe("languageWarning", () => {
	it("says nothing for English", () => {
		expect(languageWarning(detected(true, ["en", 99]))).toBeNull();
		expect(languageWarning(detected(true, ["en-GB", 99]))).toBeNull();
		expect(languageWarning(detected(true, ["fr", 20], ["en", 78]))).toBeNull();
	});

	it("says nothing when the detection is unreliable or empty", () => {
		expect(languageWarning(detected(false, ["fr", 99]))).toBeNull();
		expect(languageWarning(detected(true))).toBeNull();
		expect(languageWarning(detected(true, ["und", 100]))).toBeNull();
	});

	it("names the language otherwise", () => {
		expect(languageWarning(detected(true, ["en", 10], ["fr", 88]))).toBe(
			"This looks like French. tiny-voca only reads English, so it will sound wrong.",
		);
		expect(languageWarning(detected(true, ["de", 97]))).toContain("German");
	});

	it("falls back to the code for a language without a name", () => {
		expect(languageWarning(detected(true, ["not a code", 97]))).toContain(
			"not a code",
		);
	});
});
