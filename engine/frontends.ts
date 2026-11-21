// Text front ends: the code that turns text into a model's tokens. Each model in the list
// names the one it was trained with (engine/models.ts). The code of every front end ships in
// the add-on, fetched at a pinned commit by scripts/fetch-assets.ts; it can never be
// downloaded. See docs/FINDINGS.md §13 and §14.
import { G2P, makeChunks, makeNormalizeGerman, makePrepare, makeTokenize, normalizeText } from "apptor/apptor-tts.js";
import { Dizione } from "dizione-ptbr/engine.ts";
import { normalize as normalizePortuguese } from "dizione-ptbr/normalize.ts";
import * as spanish from "tiny-voca-es/frontend.js";
import * as french from "tiny-voca-fr/frontend-fr.js";
import { creaG2P } from "vocina/g2p_it.js";
import { isWord } from "./align.ts";
import { loadEspeak } from "./espeak.ts";
import { BENGALI, bengaliMixed, espeakText, TURKISH } from "./espeak-text.ts";
import { malayalamFrontEnd } from "./malayalam.ts";
import { ModelError } from "./models.ts";
import { loadPhonemizer, type Phonemes, phonemize, type WordTokens } from "./phonemizer.ts";

/**
 * Text to token ids, stress and the tokens of every spoken word. Null: nothing to pronounce.
 * A front end that runs a model of its own answers with a promise.
 */
export type FrontEnd = (text: string) => Phonemes | null | Promise<Phonemes | null>;

/** What some front ends need besides the package's files. */
export interface FrontEndNeeds {
  /** ONNX Runtime, for a front end with a model of its own. */
  ort?: { InferenceSession: { create(model: Uint8Array, options: object): Promise<unknown> }; Tensor: unknown };
  /** The model's helper file from storage (engine/models.ts), or null when it is not there. */
  helper?: () => Promise<Uint8Array | null>;
}

/** Reads a file of the add-on package, by its path from the package root. */
type ReadAsset = (path: string) => Promise<ArrayBuffer>;

const words = new Intl.Segmenter(undefined, { granularity: "word" });
/** The words of a text a front end has already rewritten ("15" is "quinze" by now), in order. */
const wordsOf = (text: string) => [...words.segment(text)].filter(isWord).map((part) => part.segment);

/**
 * Accented letters as one character each. Text from a PDF often has them as a letter and a
 * separate mark, which these front ends would read as two things.
 */
const composed = (text: string) => text.normalize("NFC");

/** The first 17 symbols of every tiny-voca table: five special tokens and twelve punctuation marks. */
const FIRST_PHONE = 17;

/**
 * Phonemes from a front end that gives one flat list of symbols. Words are separated by a
 * pause token or a mark, so each run of phones is one spoken word. Their texts come from the
 * front end's rewritten text, or are given one by one; unless there is exactly one text per
 * run, the words are dropped rather than guessed, and only the sentence is highlighted.
 */
export function fromSymbols(
  spoken: { ids: number[]; stress: number[] },
  rewritten: string | string[],
  isPhone = (id: number) => id >= FIRST_PHONE,
): Phonemes | null {
  const runs: WordTokens[] = [];
  let start = -1;
  spoken.ids.forEach((id, index) => {
    if (isPhone(id)) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push({ text: "", tokenStart: start, tokenEnd: index });
      start = -1;
    }
  });
  if (!runs.length) return null;
  const texts = typeof rewritten === "string" ? wordsOf(rewritten) : rewritten;
  const named = texts.length === runs.length;
  return {
    ids: spoken.ids,
    stress: spoken.stress,
    words: named ? runs.map((run, index) => ({ ...run, text: texts[index] ?? "" })) : [],
  };
}

/**
 * What stands between spaces and has a letter or a digit in it, without the signs around it.
 * This is what eSpeak NG takes for one word: "allez-vous" is one, "50 %" is one.
 */
const spacedWords = (text: string) =>
  text
    .split(/\s+/)
    // Marks count as part of a word: a Bengali word may end in a vowel sign.
    .map((word) => word.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ""))
    .filter(Boolean);

/**
 * tiny-voca's `text.py` for one language: a model's own JavaScript port of it (see
 * engine/vendor.d.ts), or this repository's (engine/espeak-text.ts).
 */
type EspeakParts = Pick<
  typeof spanish,
  "SYMBOLS" | "NothingToPronounce" | "normalizeText" | "chunks" | "parseEspeak" | "tokenize"
>;

/**
 * A front end that works from eSpeak NG's output, as the model was trained. `parts` is the
 * model's own code for everything around eSpeak NG; this is its `phonemize`, which also notes
 * how many words eSpeak NG spoke for each piece of text.
 *
 * eSpeak NG gives phonemes and not the words it read ("15" comes back as the sounds of
 * "quince"). A piece between two marks where it spoke as many words as the text has gets its
 * words named one for one. In any other piece the words stay nameless, and the alignment
 * gives that piece's words one span together.
 */
function espeakFrontEnd(parts: EspeakParts, espeak: (text: string) => string): FrontEnd {
  // After the special tokens and this language's punctuation marks; <unk> stands for a phone too.
  const firstPhone = parts.SYMBOLS.findIndex((symbol, index) => index > 4 && /\p{L}/u.test(symbol));
  return (input) => {
    const names: string[] = [];
    try {
      const pieces = parts.chunks(parts.normalizeText(input)).map(([isPunctuation, piece]): spanish.EspeakPiece => {
        if (isPunctuation) return [true, piece];
        const spoken = parts.parseEspeak(espeak(piece));
        const written = spacedWords(piece);
        names.push(...(written.length === spoken.length ? written : spoken.map(() => "")));
        return [false, spoken];
      });
      return fromSymbols(parts.tokenize(pieces), names, (id) => id >= firstPhone || id === 4);
    } catch (error) {
      if (error instanceof parts.NothingToPronounce) return null;
      throw error;
    }
  };
}

/**
 * Sets up the front end called `name`. Rejects with a ModelError for one this build does not
 * have: a model that names it cannot be used.
 */
export async function loadFrontEnd(name: string, read: ReadAsset, needs: FrontEndNeeds = {}): Promise<FrontEnd> {
  const text = async (path: string) => new TextDecoder().decode(await read(path));
  switch (name) {
    // English: upstream's JavaScript port of dizione.
    case "dizione": {
      const phonemizer = await loadPhonemizer(await read("/assets/tiny-voca-js.gguf"));
      return (input) => phonemize(phonemizer, input);
    }
    // Brazilian Portuguese: SemFence's TypeScript port of dizione-ptbr.
    case "dizione-ptbr": {
      const [lexicon, table] = await Promise.all([
        text("/assets/dizione-ptbr/lexicon.tsv"),
        text("/assets/dizione-ptbr/open_table.json"),
      ]);
      const dizione = new Dizione(lexicon, JSON.parse(table));
      return (input) => fromSymbols(dizione.phonemize(composed(input)), normalizePortuguese(composed(input)));
    }
    // Italian: vocina's own converter, with the Wiktionary lexicon it was trained with.
    case "g2p-it": {
      const [data, lexicon] = await Promise.all([
        text("/assets/g2p-it/dati.json"),
        text("/assets/g2p-it/lessico_wikizionario.json"),
      ]);
      const g2p = creaG2P({ ...JSON.parse(data), wikizionario: JSON.parse(lexicon).voci });
      // The last eight symbols of its table are reserved and never produced.
      return (input) => fromSymbols(g2p.fonemi(composed(input)), g2p.normalizza(composed(input)));
    }
    // German: apptor's front end. Words are read by a letter-to-sound model, downloaded with the voice.
    case "g2p-de": {
      const [model, tables, exceptions, meta] = await Promise.all([
        needs.helper?.(),
        text("/assets/g2p-de/frontend-de.json").then(JSON.parse),
        text("/assets/g2p-de/exceptions-de.json").then(JSON.parse),
        text("/assets/g2p-de/apptor-g2p-de.json").then(JSON.parse),
      ]);
      if (!needs.ort || !model) throw new ModelError("its letter-to-sound model is not downloaded");
      const session = await needs.ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
      const g2p = new G2P(needs.ort, session, meta, exceptions);
      const [prepare, normalizeGerman, chunks, tokenize] = [
        makePrepare,
        makeNormalizeGerman,
        makeChunks,
        makeTokenize,
      ].map((make) => make(tables)) as [
        ReturnType<typeof makePrepare>,
        ReturnType<typeof makeNormalizeGerman>,
        ReturnType<typeof makeChunks>,
        ReturnType<typeof makeTokenize>,
      ];
      const firstPhone = (tables.symbols as string[]).indexOf((tables.phones as string[])[0] ?? "");
      // Its own `phonemize`, which also keeps the word each run of phones was read from.
      return async (input) => {
        const names: string[] = [];
        const pieces: Parameters<typeof tokenize>[0] = [];
        for (const [isPunctuation, piece] of chunks(normalizeText(normalizeGerman(normalizeText(prepare(input)))))) {
          if (isPunctuation) {
            pieces.push([true, piece]);
            continue;
          }
          const words = [];
          for (const word of piece.split(" ").filter(Boolean)) {
            const units = await g2p.word(word);
            if (!units.length) continue;
            words.push(units);
            names.push(...spacedWords(word), ...(spacedWords(word).length ? [] : [""]));
          }
          pieces.push([false, words]);
        }
        try {
          return fromSymbols(tokenize(pieces), names, (id) => id >= firstPhone || id === 4);
        } catch {
          return null; // its "nothing to pronounce"
        }
      };
    }
    // Castilian Spanish and French: the models' own front ends, fed by eSpeak NG as wasm.
    case "espeak-es":
      return espeakFrontEnd(spanish, await loadEspeak(read, "es"));
    case "espeak-fr":
      return espeakFrontEnd(french, await loadEspeak(read, "fr-fr"));
    // Turkish: no JavaScript front end came with the model, so tiny-voca's own, ported, with its tables.
    case "espeak-tr":
      return espeakFrontEnd(espeakText(TURKISH), await loadEspeak(read, "tr"));
    // Bengali: the same port, with tiny-swara's tables and its way with English words.
    case "espeak-bn": {
      const [bengali, english] = await Promise.all([loadEspeak(read, "bn"), loadEspeak(read, "en-us")]);
      return espeakFrontEnd(espeakText(BENGALI), bengaliMixed(bengali, english));
    }
    // Malayalam: a port of the model's own front end, which is not tiny-voca's.
    case "espeak-ml":
      return malayalamFrontEnd(await loadEspeak(read, "ml"), spacedWords);
    default:
      throw new ModelError(`it needs the text front end "${name}", which this version of Tiny Reader does not have`);
  }
}
