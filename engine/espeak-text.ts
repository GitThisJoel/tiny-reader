// tiny-voca's text front end for a model trained on eSpeak NG's output: normalising, cutting at
// punctuation, reading eSpeak NG's output and mapping its phonemes to the model's tokens. A port
// of `text.py` as the community models have it (https://github.com/n4ze3m/tiny-voca, Apache-2.0),
// with what differs between languages given as a profile. Used where a model's makers wrote no
// JavaScript front end of their own; the parity tests hold it to their Python one.
import bengaliInventory from "tiny-swara/inventory.json";
import bengaliLexicon from "tiny-swara/lexicon.json";
import { ModelError } from "./models.ts";

/** What is specific to one model's language. */
export interface EspeakProfile {
  consonants: readonly string[];
  vowels: readonly string[];
  /** eSpeak NG phonemes outside the inventory, as the inventory phones to use instead. */
  fallback: Readonly<Record<string, readonly string[]>>;
  /** Lower-case words after which a full stop does not end anything. */
  abbreviations: readonly string[];
  /** The letters such a word may be made of: every letter, or only A to Z. */
  abbreviationLetters?: "any" | "ascii";
  /** Marks rewritten to one of the twelve punctuation tokens, besides the usual quotes and dashes. */
  marks?: Readonly<Record<string, string>>;
  /** The language's own clean-up, after the general one. */
  normalize?: (text: string) => string;
  /** eSpeak NG writes some long vowels as a doubled letter ("ɯɯ"): try the length mark for those. */
  doubledIsLong?: boolean;
}

type Word = [phone: string, stress: number][];
type Piece = [isPunctuation: true, mark: string] | [isPunctuation: false, words: Word[]];

const SPECIALS = ["<pad>", "<bos>", "<eos>", "<sp>", "<unk>"] as const;
const [, BOS, EOS, SP, UNK] = SPECIALS;
const PUNCTUATION = [",", ".", "?", "!", ";", ":", '"', "'", "(", ")", "—", "…"];
const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "`": "'",
  "´": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "«": '"',
  "»": '"',
  "–": "—",
  "―": "—",
  "[": "(",
  "{": "(",
  "]": ")",
  "}": ")",
};
const STRESS_MARKS: [string, number][] = [
  ["ˈ", 1],
  ["ˌ", 2],
];
/** "(en)", "(tr)": eSpeak NG's notes that it switched voice. */
const LANGUAGE_TAG = /\((?:_?[a-z0-9]_?){2,3}(?:-(?:_?[a-z0-9]_?)+)*\)/g;

// Python's str methods, near enough: isalnum, isalpha, isdigit (decimal digits and the
// superscript and subscript ones), and unicodedata.combining.
const isAlnum = (char: string) => /^[\p{L}\p{N}]$/u.test(char);
const isAlpha = (char: string) => /^\p{L}$/u.test(char);
const isDigit = (char: string) => /^[\p{Nd}²³¹⁰⁴-⁹₀-₉]$/u.test(char);
const withoutMarks = (text: string) => text.normalize("NFD").replace(/\p{Mn}/gu, "");

/** The front end of one language, in the shape `espeakFrontEnd` in engine/frontends.ts takes. */
export function espeakText(profile: EspeakProfile) {
  const phones = [...profile.consonants, ...profile.vowels];
  const SYMBOLS = [...SPECIALS, ...PUNCTUATION, ...phones];
  const ids = new Map(SYMBOLS.map((symbol, index) => [symbol, index]));
  const phoneSet = new Set(phones);
  const vowelSet = new Set(profile.vowels);
  const marks = new Set(PUNCTUATION);
  const abbreviations = new Set(profile.abbreviations);
  const quotes = { ...QUOTES, ...profile.marks };
  const inAbbreviation = profile.abbreviationLetters === "ascii" ? /^[A-Za-z]$/ : /^[\p{L}\p{Nl}\p{No}]$/u;

  class NothingToPronounce extends ModelError {}

  function normalizeText(text: string): string {
    let out = "";
    for (const char of text.normalize("NFKC")) out += quotes[char] ?? char;
    out = out
      .replace(/\.{3,}/g, "…")
      .replace(/-{2,}|\s-\s/g, "—")
      .replace(/\s+/g, " ")
      .trim();
    return profile.normalize ? profile.normalize(out) : out;
  }

  /** The text cut at punctuation. Decimals, clock times, abbreviations and initials stay whole. */
  function chunks(text: string): ([isPunctuation: true, mark: string] | [isPunctuation: false, text: string])[] {
    const out: ReturnType<typeof chunks> = [];
    const chars = Array.from(text);
    let start = 0;
    chars.forEach((char, i) => {
      if (!marks.has(char)) return;
      const previous = chars[i - 1] ?? "";
      const following = chars[i + 1] ?? "";
      if (char === "'" && isAlnum(previous) && isAlnum(following)) return;
      if (".,:".includes(char) && isDigit(previous) && isDigit(following)) return;
      if (char === ".") {
        // The word that ends here, found by walking back from the full stop.
        let from = i;
        while (from > 0 && inAbbreviation.test(chars[from - 1] ?? "")) from--;
        if (from < i && abbreviations.has(chars.slice(from, i).join("").toLowerCase())) return;
        if (isAlpha(previous) && isAlpha(following)) return;
      }
      const piece = chars.slice(start, i).join("").trim();
      if (piece) out.push([false, piece]);
      out.push([true, char]);
      start = i + 1;
    });
    const rest = chars.slice(start).join("").trim();
    if (rest) out.push([false, rest]);
    return out;
  }

  /** eSpeak NG's output for a piece of text, as words of phonemes with their stress. */
  function parseEspeak(output: string): Word[] {
    const words: Word[] = [];
    for (const word of output.replace(LANGUAGE_TAG, "").split(/\s+/).filter(Boolean)) {
      const units: Word = [];
      for (let unit of word.split("_")) {
        let stress = 0;
        for (const [mark, level] of STRESS_MARKS)
          if (unit.includes(mark)) {
            stress = stress || level;
            unit = unit.replaceAll(mark, "");
          }
        unit = unit.replace(/[\p{Cf}()]/gu, "");
        if (unit) units.push([unit, stress]);
      }
      if (units.length) words.push(units);
    }
    return words;
  }

  /** An eSpeak NG phoneme as inventory phones; null when there is no way to say it. */
  function canonical(phone: string): readonly string[] | null {
    if (phoneSet.has(phone)) return [phone];
    const listed = (candidate: string) =>
      Object.hasOwn(profile.fallback, candidate) ? profile.fallback[candidate] : null;
    const direct = listed(phone);
    if (direct) return direct;
    const [first, second, third] = Array.from(phone);
    if (profile.doubledIsLong && first && first === second && third === undefined && phoneSet.has(`${first}ː`))
      return [`${first}ː`];
    const stripped = withoutMarks(phone);
    for (const candidate of [stripped, stripped.replaceAll("ː", ""), `${stripped}ː`]) {
      if (candidate === phone) continue;
      if (phoneSet.has(candidate)) return [candidate];
      const mapped = listed(candidate);
      if (mapped) return mapped;
    }
    return null;
  }

  function tokenize(pieces: Piece[]) {
    const symbols: string[] = [BOS];
    const stress = [0];
    for (const [isPunctuation, value] of pieces) {
      if (isPunctuation) {
        // Repeats such as "!!" are one token.
        if (symbols.at(-1) !== value) {
          symbols.push(value);
          stress.push(0);
        }
        continue;
      }
      for (const word of value) {
        const last = symbols.at(-1) ?? "";
        if (phoneSet.has(last) || last === UNK) {
          symbols.push(SP);
          stress.push(0);
        }
        for (const [phone, level] of word) {
          const mapped = canonical(phone) ?? [UNK];
          // A fallback may be several phones: the stress goes to its first vowel.
          const carrier = Math.max(
            0,
            mapped.findIndex((item) => vowelSet.has(item)),
          );
          mapped.forEach((item, index) => {
            symbols.push(item);
            stress.push(index === carrier ? level : 0);
          });
        }
      }
    }
    symbols.push(EOS);
    stress.push(0);
    if (!symbols.some((symbol) => phoneSet.has(symbol) || symbol === UNK))
      throw new NothingToPronounce("nothing to pronounce");
    return { symbols, ids: symbols.map((symbol) => ids.get(symbol) ?? 4), stress };
  }

  return { SYMBOLS, NothingToPronounce, normalizeText, chunks, parseEspeak, tokenize };
}

/**
 * Turkish, for `erkint/zerre-tts`: the tables and the clean-up of `src/zerre/lang/tr.py` in
 * https://github.com/erkinemreta1/zerre-tts at cf3cdfa (Apache-2.0).
 */
export const TURKISH: EspeakProfile = {
  // Palatal /c, ɟ/ and velar /k, g/ contrast before front and back vowels, so both are phones.
  consonants: ["p", "b", "t", "d", "c", "ɟ", "k", "g", "f", "v", "s", "z", "ʃ", "ʒ", "h"].concat([
    "m",
    "n",
    "ɲ",
    "ŋ",
    "l",
    "ɫ",
    "ɾ",
    "r",
    "j",
    "w",
    "tʃ",
    "dʒ",
  ]),
  vowels: ["a", "e", "i", "o", "u", "y", "ø", "œ", "ɯ", "aː", "eː", "iː", "oː", "uː", "yː", "øː", "œː", "ɯː"],
  fallback: {
    r: ["ɾ"],
    ɹ: ["ɾ"],
    ʀ: ["ɾ"],
    ɡ: ["g"],
    ɯɯ: ["ɯː"],
    θ: ["t"],
    ð: ["d"],
    ɣ: ["g"],
    x: ["h"],
    q: ["k"],
    ʎ: ["l", "j"],
    ɬ: ["l"],
    ts: ["t", "s"],
    dz: ["d", "z"],
    β: ["v"],
    ʋ: ["v"],
    ɸ: ["f"],
    ʂ: ["ʃ"],
    ʐ: ["ʒ"],
    ə: ["a"],
    ɛ: ["e"],
    æ: ["e"],
    ɪ: ["i"],
    ɔ: ["o"],
    ʊ: ["u"],
    ʌ: ["a"],
    ɐ: ["a"],
    ɜ: ["e"],
    ɨ: ["ɯ"],
    ʏ: ["y"],
    ɑ: ["a"],
    ɒ: ["a"],
    ɵ: ["œ"],
    pʰ: ["p"],
    tʰ: ["t"],
    kʰ: ["k"],
    cʰ: ["c"],
    tʃʰ: ["tʃ"],
  },
  // As in zerre's tr.py, word for word. Its last entry has a full stop and so never matches: "yy" does the work.
  abbreviations: "dr prof doç av vb vs bkz örn mah cad sok no tel tk tbmm trt ab abd bk yy yy.".split(" "),
  doubledIsLong: true,
  normalize: (text) =>
    text
      // A suffix on a proper noun is written after an apostrophe and read as one word: Ankara'da.
      .replace(/(?<=[\p{L}\p{Nl}\p{No}])['’](?=[\p{L}\p{Nl}\p{No}])/gu, "")
      // After a digit it keeps a space, or eSpeak NG sees no number: 1923'te.
      .replace(/(?<=\p{Nd})['’](?=[\p{L}\p{Nl}\p{No}])/gu, " ")
      .replace(/\s*&\s*/g, " ve ")
      .replace(/%\s*(?=\p{Nd})/gu, "yüzde ")
      .replaceAll("₺", " TL ")
      .replace(/\s+/g, " ")
      .trim(),
};

/**
 * Bengali, for `Xeven7/tiny-swara`: its inventory file, and what its `tiny_voca/text.py` adds to
 * tiny-voca's (Apache-2.0). The danda ends a sentence like a full stop.
 */
export const BENGALI: EspeakProfile = {
  consonants: bengaliInventory.consonants,
  vowels: bengaliInventory.vowels,
  fallback: bengaliInventory.fallback,
  abbreviations: ["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc"],
  abbreviationLetters: "ascii",
  marks: { "।": ".", "॥": "." },
};

/**
 * How tiny-swara reads a piece of Bengali text with English words in it: a word in Latin
 * letters that its lexicon knows is read from its Bengali spelling, any other one by eSpeak NG's
 * American English voice, and the rest by the Bengali voice. Resolves to what stands in for
 * eSpeak NG's output for the whole piece.
 */
export function bengaliMixed(bengali: (text: string) => string, english: (text: string) => string) {
  const lexicon = new Map(Object.entries(bengaliLexicon).map(([word, spelling]) => [word.toLowerCase(), spelling]));
  return (piece: string): string => {
    const said: string[] = [];
    let position = 0;
    for (const match of piece.matchAll(/[A-Za-z][A-Za-z']*/g)) {
      const before = piece.slice(position, match.index);
      if (before.trim()) said.push(bengali(before));
      const spelling = lexicon.get(match[0].toLowerCase());
      said.push(spelling ? bengali(spelling) : english(match[0]));
      position = match.index + match[0].length;
    }
    const rest = piece.slice(position);
    if (rest.trim()) said.push(bengali(rest));
    return said.join("\n");
  };
}
