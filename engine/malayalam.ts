// Malayalam, for `Cyrax321/tui-voice-mini-ml`. Its makers did not use tiny-voca's text.py: their
// model keeps the English model's 76 token slots and gives the ones Malayalam has no use for to
// Malayalam sounds. This is a port of `tui_voice/phonemes.py` and `split_clauses` of
// `normalize` of `tui_voice/text.py` in https://github.com/Cyrax321/tui-voice at 478761a (Apache-2.0, as its
// README says): eSpeak NG's Malayalam voice, then their table of which slot each sound takes.
import upstream from "tiny-voca-config";
import plan from "tui-voice/vocab_plan.json";
import type { Phonemes, WordTokens } from "./phonemizer.ts";

/** Sounds the English table lacks, as the English sound nearest to each. */
const NEAREST: Record<string, string> = {
  ɻ: "ɹ",
  ɭ: "l",
  ɳ: "n",
  ɖ: "d",
  ʈ: "t",
  ɽ: "ɾ",
  ɾ: "r",
  r: "ɹ",
  ɲ: "n",
  ɟ: "dʒ",
  c: "tʃ",
  g: "ɡ",
  ʋ: "v",
  ʂ: "ʃ",
  ɕ: "ʃ",
  ɨ: "ɪ",
  ɐ: "ʌ",
  o: "oʊ",
  e: "eɪ",
  ɯ: "ʊ",
  tʰ: "t",
  kʰ: "k",
  pʰ: "p",
  dʱ: "d",
  bʱ: "b",
  ɡʱ: "ɡ",
  ʈʰ: "t",
  ɖʱ: "d",
  cʰ: "tʃ",
  ɟʱ: "dʒ",
  t̪: "t",
  d̪: "d",
  n̪: "n",
  dʰ: "d",
  bʰ: "b",
  ɟʰ: "dʒ",
  ʲ: "j",
  ʈʈ: "t",
  "r.": "ɹ",
  r̩: "ɹ",
  ʰχ: "k",
  χ: "k",
  a: "ɐ",
  aː: "ɑː",
  u: "ʊ",
  uː: "uː",
  eː: "eɪ",
  oː: "oː",
  i: "ɪ",
  iː: "iː",
};
const VOWEL_LETTERS = new Set("aeiouɐɑɒɔəɛɜɪʊʌæɚɝɨɯøœyɤɵɘɞɶ");
/** Marks that end a clause and become a pause token. Any other punctuation is left to eSpeak NG. */
const PAUSE_MARKS = ",;:.?!";
/** Stress marks and the like, taken off both ends of a phoneme. Stress is not used by this model. */
const EDGE_MARKS = /^[ˈˌ'ˑ.]+|[ˈˌ'ˑ.]+$/g;
/** Length, aspiration and other modifiers, dropped when looking for a sound that is in the table. */
const MODIFIERS = /[ːʰʱʲ._~-]|\u032a|\u0329/gu;

/** The English model's table: symbol to slot. */
const slots = new Map(Object.entries(upstream.vocab));
/** The Malayalam sounds that have a slot of their own or share one. */
const mapping = new Map(Object.entries(plan.mapping));

/** The symbol of the English table to use for a sound that has no slot: never fails. */
function nearest(phone: string): string {
  const known = (candidate: string) =>
    slots.has(candidate) ? candidate : slots.has(NEAREST[candidate] ?? "") ? (NEAREST[candidate] as string) : null;
  const collapsed = phone.replace(/(.)\1+/gu, "$1"); // ʈʈ as ʈ
  const bare = phone.replace(MODIFIERS, "");
  const found = known(phone) ?? known(collapsed) ?? known(bare) ?? known(collapsed.replace(MODIFIERS, "")) ?? null;
  if (found) return found;
  for (const letter of phone) {
    const single = known(letter);
    if (single) return single;
  }
  return [...phone].some((letter) => VOWEL_LETTERS.has(letter)) ? "ə" : "t";
}

/** The slot of one token: a special token, a mark, or a sound. */
const slot = (token: string): number => mapping.get(token) ?? slots.get(token) ?? slots.get(nearest(token)) ?? 4;

/**
 * eSpeak NG's marks for a word it read in another language: "(en)" before a Latin word, "(ml)" after it. The
 * makers trained without Latin letters and never met them; left in, they would be taken for sounds.
 */
const LANGUAGE_TAG = /\([a-z]{2,3}(?:-[a-z0-9]+)*\)/g;

/** eSpeak NG's output for a clause as words of phonemes, as this project reads it. */
const wordsOf = (output: string): string[][] =>
  output
    .replace(LANGUAGE_TAG, "")
    .split(/\s+/)
    .map((word) =>
      word
        .split("_")
        .map((phone) => phone.replace(EDGE_MARKS, ""))
        .filter(Boolean),
    )
    .filter((word) => word.length);

/** Characters with no sound and no shape. The two joiners that pick a letter's form are kept. */
const INVISIBLE = /[\u200b\u200e\u200f\u2060\ufeff]/g;
/** Marks written in other ways, as the plain mark the model knows: an ellipsis and a danda end a sentence. */
const PLAIN: Record<string, string> = {
  "\u201c": '"',
  "\u201d": '"',
  "\u2018": "'",
  "\u2019": "'",
  "\u2026": ".",
  "\u2013": "-",
  "\u2014": "-",
  "\u0964": ".",
};
/** `normalize` of `tui_voice/text.py`: what every text the model learned from went through. */
const normalize = (text: string) =>
  text
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/[\u201c\u201d\u2018\u2019\u2026\u2013\u2014\u0964]/g, (mark) => PLAIN[mark] ?? mark)
    .replace(/["'()[\]{}<>*_/\\|~^`#@$%&+=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** A digit, European or Malayalam. */
const isDigit = (char: string | undefined) => char !== undefined && /[0-9\u0d66-\u0d6f]/.test(char);

/**
 * The front end. `espeak` gives eSpeak NG's output for a piece of text with its Malayalam voice;
 * `named` gives the words of a clause as they are written, to name the spoken ones by.
 */
export function malayalamFrontEnd(espeak: (text: string) => string, named: (clause: string) => string[]) {
  return (text: string): Phonemes | null => {
    const tokens = ["<bos>"];
    const words: WordTokens[] = [];
    let clause = "";
    const speak = (mark: string) => {
      const written = clause.trim();
      clause = "";
      if (!written) return;
      const spoken = wordsOf(espeak(written));
      const names = named(written);
      spoken.forEach((word, index) => {
        if (index) tokens.push("<sp>");
        words.push({
          text: names.length === spoken.length ? (names[index] ?? "") : "",
          tokenStart: tokens.length,
          tokenEnd: tokens.length + word.length,
        });
        tokens.push(...word);
      });
      // A clause that ends without a mark is followed by a word boundary.
      if (mark) tokens.push(mark);
      else if (spoken.length) tokens.push("<sp>");
    };
    // The makers left sentences with digits out of the training, so their code cuts "3.5" in two. A page
    // has numbers: a mark between two digits stays in its number, for eSpeak NG to read as one.
    const chars = [...normalize(text)];
    chars.forEach((char, index) => {
      const inNumber = isDigit(chars[index - 1]) && isDigit(chars[index + 1]);
      if (PAUSE_MARKS.includes(char) && !inNumber) speak(char);
      else clause += char;
    });
    speak("");
    while (tokens.at(-1) === "<sp>") tokens.pop();
    tokens.push("<eos>");
    if (!words.length) return null;
    return { ids: tokens.map(slot), stress: tokens.map(() => 0), words };
  };
}
