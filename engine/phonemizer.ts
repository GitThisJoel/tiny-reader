import { fromGGUF, type Phonemizer } from "tiny-voca/dizione/engine.js";
import { groups, type Unit } from "tiny-voca/dizione/sentence.js";
import { type Piece, tokenize, ValueError } from "tiny-voca/dizione/symbols.js";
import { readGGUF } from "tiny-voca/tiny-voca.js";

export type { Phonemizer };

/** A spoken word and the tokens it owns: ids[tokenStart..tokenEnd). */
export interface WordTokens {
	text: string;
	tokenStart: number;
	tokenEnd: number;
}

export interface Phonemes {
	ids: number[];
	stress: number[];
	words: WordTokens[];
}

export const loadPhonemizer = (gguf: ArrayBuffer): Promise<Phonemizer> =>
	fromGGUF(readGGUF(gguf));

/**
 * Text to token ids, stress and the token range of every spoken word.
 * Returns null when there is nothing to pronounce (another script, signs only).
 *
 * The ids come from upstream's own `tokenize`, exactly as `Phonemizer.phonemize` makes them.
 * The word ranges come from walking the same units the same way; if the two ever disagree on
 * the token count, the words are dropped rather than trusted.
 */
export function phonemize(
	phonemizer: Phonemizer,
	text: string,
): Phonemes | null {
	if (!text.trim()) return null;
	const analysed = phonemizer.analyse(text);
	let result: ReturnType<typeof tokenize>;
	try {
		result = tokenize(
			analysed.map(
				(piece): Piece =>
					piece[0] === "punct" ? [true, piece[1]] : [false, groups(piece[1])],
			),
		);
	} catch (error) {
		if (error instanceof ValueError) return null;
		throw error;
	}

	const words: WordTokens[] = [];
	const SPOKEN = "\0"; // stands for "the last symbol was a phone"
	let at = 1; // after <bos>
	let last = "<bos>";
	for (const piece of analysed) {
		if (piece[0] === "punct") {
			if (last !== piece[1]) at += 1;
			last = piece[1];
			continue;
		}
		const grouped: Unit[][] = [];
		for (const unit of piece[1]) {
			const open = grouped.at(-1);
			if (unit.attach && open) open.push(unit);
			else grouped.push([unit]);
		}
		for (const group of grouped) {
			if (!group.some((unit) => unit.phones.length)) continue;
			if (last === SPOKEN) at += 1; // <sp>
			for (const unit of group) {
				if (!unit.phones.length) continue;
				words.push({
					text: unit.word,
					tokenStart: at,
					tokenEnd: at + unit.phones.length,
				});
				at += unit.phones.length;
			}
			last = SPOKEN;
		}
	}
	const agrees = at + 1 === result.ids.length;
	return { ids: result.ids, stress: result.stress, words: agrees ? words : [] };
}
