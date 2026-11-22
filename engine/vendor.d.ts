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
  export type Piece = [isPunctuation: true, mark: string] | [isPunctuation: false, words: Phone[][]];
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
  export type Analysed = [kind: "punct", mark: string] | [kind: "clause", units: Unit[]];
  export class Phonemizer {
    analyse(text: string): Analysed[];
    phonemize(text: string): Phonemized;
  }
  export function fromGGUF(file: GGUF): Promise<Phonemizer>;
}

// SemFence's TypeScript port of dizione-ptbr. Reached through a Vite alias only (wxt.config.ts),
// so that tsc reads these declarations and not its sources, written for other compiler settings.
declare module "dizione-ptbr/engine.ts" {
  export class Dizione {
    constructor(lexiconTsv: string, openTable: Readonly<Record<string, string>>);
    phonemize(
      text: string,
      useLexicon?: boolean,
      doNormalize?: boolean,
    ): { symbols: string[]; stress: number[]; readonly ids: number[] };
  }
}
declare module "dizione-ptbr/normalize.ts" {
  /** Numbers, money, times and abbreviations written out in words. */
  export function normalize(text: string): string;
}
declare module "dizione-ptbr/symbols.ts" {
  export const SYMBOLS: readonly string[];
}

// vocina's Italian converter, plain JavaScript.
declare module "vocina/g2p_it.js" {
  export function creaG2P(data: Record<string, unknown>): {
    /** Numbers, dates and abbreviations written out in words. */
    normalizza(text: string): string;
    fonemi(text: string): { symbols: string[]; ids: number[]; stress: number[] };
    SYMBOLS: string[];
  };
}
