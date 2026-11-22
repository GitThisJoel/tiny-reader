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

// eSpeak NG's emscripten glue, built by scripts/build-espeak.sh.
declare module "espeak/espeak-ng-core.mjs" {
  export interface EspeakCore {
    FS: { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array): void };
    HEAPU8: Uint8Array;
    HEAP32: Int32Array;
    lengthBytesUTF8(text: string): number;
    stringToUTF8(text: string, pointer: number, size: number): void;
    _malloc(size: number): number;
    _free(pointer: number): void;
    UTF8ToString(pointer: number): string;
    _tr_init(dataPath: number): number;
    _tr_voice(voice: number): number;
    _tr_version(): number;
    _tr_phonemize(input: number, length: number, outputLength: number): number;
  }
  export default function createEspeakCore(options: {
    wasmBinary: ArrayBuffer;
    noInitialRun: boolean;
    print(line: string): void;
    printErr(line: string): void;
  }): Promise<EspeakCore>;
}

// The front ends that work from eSpeak NG's output: each model's own JavaScript port of tiny-voca's
// text.py for its language. They export the same things.
declare module "tiny-voca-es/frontend.js" {
  export type EspeakWord = [phone: string, stress: number][];
  export type EspeakPiece = [isPunctuation: true, mark: string] | [isPunctuation: false, words: EspeakWord[]];
  /** Thrown when the text has no word, number or letter to say. */
  export class NothingToPronounce extends Error {}
  export const SYMBOLS: string[];
  export function normalizeText(text: string): string;
  /** The text cut at punctuation: [true, mark] or [false, text between marks]. */
  export function chunks(text: string): ([isPunctuation: true, mark: string] | [isPunctuation: false, text: string])[];
  /** eSpeak NG's output for one piece of text, as words. */
  export function parseEspeak(output: string): EspeakWord[];
  export function tokenize(pieces: EspeakPiece[]): { symbols: string[]; ids: number[]; stress: number[] };
}
declare module "tiny-voca-fr/frontend-fr.js" {
  export * from "tiny-voca-es/frontend.js";
}

// apptor's German front end: normalising, numbers and a letter-to-sound model run with ONNX Runtime.
declare module "apptor/apptor-tts.js" {
  type Units = [phone: string, stress: number][];
  /** The tables in frontend-de.json. */
  export type Tables = Record<string, unknown>;
  export class G2P {
    /** `session` is the letter-to-sound model; `meta` its description; `exceptions` words read from a table. */
    constructor(ort: unknown, session: unknown, meta: unknown, exceptions?: Record<string, string>);
    /** One written word to its phones. Empty for a word with nothing to say. */
    word(word: string): Promise<Units>;
  }
  export function normalizeText(text: string): string;
  export function makePrepare(tables: Tables): (text: string) => string;
  export function makeNormalizeGerman(tables: Tables): (text: string) => string;
  export function makeChunks(
    tables: Tables,
  ): (text: string) => ([isPunctuation: true, mark: string] | [isPunctuation: false, text: string])[];
  export function makeTokenize(
    tables: Tables,
  ): (pieces: ([true, string] | [false, Units[]])[]) => { symbols: string[]; ids: number[]; stress: number[] };
}
