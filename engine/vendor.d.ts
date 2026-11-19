// Types for upstream's plain-JS phonemizer (vendor/, fetched by `pnpm fetch-assets`).
// Only what the engine uses is declared.

declare module "tiny-voca/tiny-voca.js" {
	export interface GGUF {
		meta: Record<string, unknown>;
		tensors: Record<string, unknown>;
		files: Record<string, Uint8Array>;
	}
	export function readGGUF(buffer: ArrayBuffer): GGUF;
}

declare module "tiny-voca/dizione/symbols.js" {
	export type Phone = [symbol: string, stress: number];
	export type Piece =
		| [isPunctuation: true, mark: string]
		| [isPunctuation: false, words: Phone[][]];
	export interface Phonemized {
		symbols: string[];
		ids: number[];
		stress: number[];
		unknown: string[];
	}
	export class ValueError extends Error {}
	export const PHONE_SET: Set<string>;
	/** Throws ValueError when the pieces contain nothing to pronounce. */
	export function tokenize(pieces: Piece[]): Phonemized;
}

declare module "tiny-voca/dizione/sentence.js" {
	import type { Phone } from "tiny-voca/dizione/symbols.js";
	export interface Unit {
		/** The spoken word, lower case. May hold several words for a fixed phrase. */
		word: string;
		phones: Phone[];
		/** Spoken as part of the previous word, with no word boundary before it. */
		attach: boolean;
	}
	export function groups(units: Unit[]): Phone[][];
}

declare module "tiny-voca/dizione/engine.js" {
	import type { Unit } from "tiny-voca/dizione/sentence.js";
	import type { Phonemized } from "tiny-voca/dizione/symbols.js";
	import type { GGUF } from "tiny-voca/tiny-voca.js";
	export type Analysed =
		| [kind: "punct", mark: string]
		| [kind: "clause", units: Unit[]];
	export class Phonemizer {
		analyse(text: string): Analysed[];
		phonemize(text: string): Phonemized;
	}
	export function fromGGUF(file: GGUF): Promise<Phonemizer>;
}
