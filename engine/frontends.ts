// Text front ends: the code that turns text into a model's tokens. Each model in the list
// names the one it was trained with (engine/models.ts). The code of every front end ships in
// the add-on, fetched at a pinned commit by scripts/fetch-assets.ts; it can never be
// downloaded. See docs/FINDINGS.md §13 and §14.
import { Dizione } from "dizione-ptbr/engine.ts";
import { normalize as normalizePortuguese } from "dizione-ptbr/normalize.ts";
import { creaG2P } from "vocina/g2p_it.js";
import { ModelError } from "./models.ts";
import { loadPhonemizer, type Phonemes, phonemize, type WordTokens } from "./phonemizer.ts";

/** Text to token ids, stress and the tokens of every spoken word. Null: nothing to pronounce. */
export type FrontEnd = (text: string) => Phonemes | null;

/** Reads a file of the add-on package, by its path from the package root. */
type ReadAsset = (path: string) => Promise<ArrayBuffer>;

const words = new Intl.Segmenter(undefined, { granularity: "word" });
/** The words of a text a front end has already rewritten ("15" is "quinze" by now), in order. */
const wordsOf = (text: string) =>
  [...words.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment);

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
 * front end's rewritten text; unless there is exactly one text per run, the words are dropped
 * rather than guessed, and only the sentence is highlighted.
 */
export function fromSymbols(
  spoken: { ids: number[]; stress: number[] },
  rewritten: string,
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
  const texts = wordsOf(rewritten);
  const named = texts.length === runs.length;
  return {
    ids: spoken.ids,
    stress: spoken.stress,
    words: named ? runs.map((run, index) => ({ ...run, text: texts[index] ?? "" })) : [],
  };
}

/**
 * Sets up the front end called `name`. Rejects with a ModelError for one this build does not
 * have: a model that names it cannot be used.
 */
export async function loadFrontEnd(name: string, read: ReadAsset): Promise<FrontEnd> {
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
      return (input) => {
        // Rewritten once, and phonemized as it is. An apostrophe ends a word for this front end ("d'água" is two).
        const rewritten = normalizePortuguese(composed(input));
        return fromSymbols(dizione.phonemize(rewritten, true, false), rewritten.replace(/['’]/g, " "));
      };
    }
    // Italian: vocina's own converter, with the Wiktionary lexicon it was trained with.
    case "g2p-it": {
      const [data, lexicon] = await Promise.all([
        text("/assets/g2p-it/dati.json"),
        text("/assets/g2p-it/lessico_wikizionario.json"),
      ]);
      const g2p = creaG2P({ ...JSON.parse(data), wikizionario: JSON.parse(lexicon).voci });
      // The last eight symbols of its table are reserved and never produced.
      // ponytail: `fonemi` rewrites the text itself and cannot be told not to, so it is rewritten twice.
      return (input) => {
        const text = composed(input);
        return fromSymbols(g2p.fonemi(text), g2p.normalizza(text));
      };
    }
    default:
      throw new ModelError(`it needs the text front end "${name}", which this version of Tiny Reader does not have`);
  }
}
