import { splitLong } from "@/engine/text.ts";

/** A stretch of the source text to speak in one go: text.slice(start, end). */
export interface Sentence {
	text: string;
	start: number;
	end: number;
}

// Intl.Segmenter breaks after titles and initials ("Mr. |Smith", "J. |R. |R. |Tolkien").
// Same list as tiny-voca's own splitter.
const ABBREVIATION =
	/(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|inc|ltd|co|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.[ \t]+$/i;
const SPEAKABLE = /[\p{L}\p{N}]/u;

/**
 * Longest sentence sent to the engine in one request. Longer ones are cut at commas, then
 * between words, so the first audio never waits on a huge synthesis. The engine has its own
 * limit in tokens; this one only bounds latency.
 */
export const MAX_SENTENCE_LENGTH = 300;

export function segment(
	text: string,
	maxLength = MAX_SENTENCE_LENGTH,
): Sentence[] {
	const merged: { start: number; end: number }[] = [];
	let carry: number | null = null;
	for (const { segment: part, index } of new Intl.Segmenter("en", {
		granularity: "sentence",
	}).segment(text)) {
		const start: number = carry ?? index;
		const end = index + part.length;
		if (ABBREVIATION.test(part)) {
			carry = start;
			continue;
		}
		carry = null;
		merged.push({ start, end });
	}
	if (carry !== null) merged.push({ start: carry, end: text.length });

	const sentences: Sentence[] = [];
	for (const { start, end } of merged) {
		for (const piece of splitLong(
			text.slice(start, end),
			(candidate) => candidate.trim().length > maxLength,
		)) {
			const trimmed = piece.text.trim();
			if (!SPEAKABLE.test(trimmed)) continue;
			const from = start + piece.offset + piece.text.indexOf(trimmed);
			sentences.push({
				text: trimmed,
				start: from,
				end: from + trimmed.length,
			});
		}
	}
	return sentences;
}
