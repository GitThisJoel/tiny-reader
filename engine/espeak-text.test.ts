import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BENGALI, bengaliMixed, type EspeakProfile, espeakText, TURKISH } from "./espeak-text.ts";

/** Python's json.dumps(value, sort_keys=True, ensure_ascii=False), which the models' fingerprints are taken of. */
function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(", ")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}: ${pythonJson(item)}`)
      .join(", ")}}`;
  return JSON.stringify(value);
}
const vendor = async (path: string) => JSON.parse(await readFile(join(import.meta.dirname, "../vendor", path), "utf8"));
/** The fingerprint a model's makers publish: of the front end's version, voice, symbols and fallback table. */
const fingerprint = (identity: object) => createHash("sha256").update(pythonJson(identity)).digest("hex");
const tables = (profile: EspeakProfile) => ({
  separator: "_",
  symbols: espeakText(profile).SYMBOLS,
  fallback: Object.fromEntries(Object.entries(profile.fallback).sort(([a], [b]) => (a < b ? -1 : 1))),
});

describe("the Turkish profile", () => {
  it("has exactly the symbols and fallback table the released model was made with", async () => {
    const model = await vendor("zerre-tts/model.json");
    expect(espeakText(TURKISH).SYMBOLS).toEqual(model.symbols);
    expect(fingerprint({ frontend_version: 5, language: "tr", voice: "tr", ...tables(TURKISH) })).toBe(
      model.frontend_fingerprint,
    );
  });

  it("reads a suffix after an apostrophe as part of the word, and spells out signs", () => {
    const { normalizeText } = espeakText(TURKISH);
    expect(normalizeText("Ankara’da  1923'te %15 & 20₺")).toBe("Ankarada 1923 te yüzde 15 ve 20 TL");
  });
});

describe("the Bengali profile", () => {
  it("has exactly the symbols the released model was made with, and its project's current fallback table", async () => {
    const model = await vendor("tiny-swara/model.json");
    // This model's description gives its table as symbol to id.
    expect(Object.fromEntries(espeakText(BENGALI).SYMBOLS.map((symbol, id) => [symbol, id]))).toEqual(model.vocab);
    // The fingerprint is the one tiny-swara's own text.py computes with these tables. The model's
    // description carries another: its fallback table for foreign sounds changed after the
    // release, and the earlier one is not published. The symbols, which the model's ids are, agree.
    expect(fingerprint({ frontend_version: 3, voice: "bn", ...tables(BENGALI) })).toBe(
      "9b2e2c1495ada4f44cb6a52c1fb7811fb7756beda6ae20185d9b66ef6195bada",
    );
    expect(model.frontend_fingerprint).toBe("54cece4f400be1fbb56c30bbeedbcdcf5d432702e6d8c6389f44fbb79dc4c94b");
  });

  it("takes the danda for a full stop", () => {
    const { chunks, normalizeText } = espeakText(BENGALI);
    expect(chunks(normalizeText("আমি ভাত খাই। তুমি?"))).toEqual([
      [false, "আমি ভাত খাই"],
      [true, "."],
      [false, "তুমি"],
      [true, "?"],
    ]);
  });

  it("reads an English word from its Bengali spelling when the lexicon has one, else with the English voice", () => {
    const mixed = bengaliMixed(
      (text) => `bn<${text.trim()}>`,
      (text) => `en<${text}>`,
    );
    expect(mixed("আপনার Order টি Google এ")).toBe("bn<আপনার>\nbn<অর্ডার>\nbn<টি>\nen<Google>\nbn<এ>");
    expect(mixed("শুধু বাংলা")).toBe("bn<শুধু বাংলা>");
  });
});

describe("espeakText", () => {
  const { chunks, parseEspeak, tokenize, normalizeText, NothingToPronounce } = espeakText(TURKISH);

  it("cuts at punctuation but not inside numbers, abbreviations and initials", () => {
    expect(chunks("Dr. Ay geldi, saat 14:35. A.B.D. 3,5!")).toEqual([
      [false, "Dr. Ay geldi"],
      [true, ","],
      [false, "saat 14:35"],
      [true, "."],
      [false, "A.B.D"],
      [true, "."],
      [false, "3,5"],
      [true, "!"],
    ]);
    expect(normalizeText("“Evet” -- hayır... [tamam]")).toBe('"Evet" — hayır… (tamam)');
  });

  it("reads eSpeak NG's output as words of phones with their stress, without its notes", () => {
    expect(parseEspeak("m_ˈe_ɾ_h_a_b_a (en)h_ə_l_ˌoʊ(tr)\n")).toEqual([
      [
        ["m", 0],
        ["e", 1],
        ["ɾ", 0],
        ["h", 0],
        ["a", 0],
        ["b", 0],
        ["a", 0],
      ],
      [
        ["h", 0],
        ["ə", 0],
        ["l", 0],
        ["oʊ", 2],
      ],
    ]);
  });

  it("maps phones outside the inventory, puts a pause between words and stress on the vowel", () => {
    const { symbols, stress } = tokenize([
      [
        false,
        [
          [["ʎ", 1]], // two phones in its place: the stress goes to none of them but the first
          [
            ["ɯɯ", 1], // a doubled letter is the long vowel
            ["é", 0], // a letter with a mark eSpeak NG added
            ["ʘ", 0], // nothing like it
          ],
        ],
      ],
      [true, "!"],
      [true, "!"],
    ]);
    expect(symbols).toEqual(["<bos>", "l", "j", "<sp>", "ɯː", "e", "<unk>", "!", "<eos>"]);
    expect(stress).toEqual([0, 1, 0, 0, 1, 0, 0, 0, 0]);
  });

  it("says so when there is nothing to pronounce", () => {
    expect(() => tokenize([[true, "."]])).toThrow(NothingToPronounce);
  });
});
