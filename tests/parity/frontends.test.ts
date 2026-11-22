// The front ends for other languages against their own references: the token ids and stress
// values each project's Python original produces, as recorded in files that come with its
// JavaScript port. These files are fetched by `pnpm fetch-assets`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type FrontEnd, loadFrontEnd } from "../../engine/frontends.ts";
import { readAsset } from "../assets.ts";

const vendor = async (path: string) =>
  JSON.parse(await readFile(join(import.meta.dirname, "../../vendor", path), "utf8"));

/** Sentences for which the front end could name every spoken word, so each can be highlighted. */
const named = (frontEnd: FrontEnd, sentences: string[]) =>
  sentences.filter((sentence) => frontEnd(sentence)?.words.length).length / sentences.length;

/**
 * The sample reference that comes with the port was recorded before its last commit, which
 * changed how loanwords ("app", "selfie", "TikTok") and spelled-out acronyms are said, in the
 * code and in the lexicon. These sentences contain such words; every other one must match.
 */
const STALE = [
  "Esse app de entrega é o melhor que já usei na vida!",
  "Tem apartamento pra alugar com internet e TV a cabo?",
  "Ninguém sabe o que tá acontecendo no mundo, só o que vê no TikTok.",
  "Os telefones ainda não foram extintos e substituídos pelos smartphones?",
  "Ela pegou seu celular e fez uma selfie.",
  "RH, CPF e PSG são siglas.",
  "wifi, whatsapp, pix, mouse, show, web, site",
  // Also on purpose: its accents are stored as separate marks, which the reference reads as bare
  // letters ("mãe" as "mai"). The engine composes them first, as text from a PDF needs.
  "Ã mãe (NFD) e café",
];

describe("Brazilian Portuguese (dizione-ptbr)", () => {
  it("names both words an apostrophe joins, as the front end speaks them", () => {
    for (const text of ["Um copo d'água, por favor.", "Um copo d’água, por favor."])
      expect(frontEnd(text)?.words.map((word) => word.text)).toEqual(["Um", "copo", "d", "água", "por", "favor"]);
  });

  let frontEnd: FrontEnd;
  let symbols: string[];
  let golden: { sentences: [string, string][]; edge: [string, string][] };
  beforeAll(async () => {
    frontEnd = await loadFrontEnd("dizione-ptbr", readAsset);
    // The model's own table: ids are positions in it.
    symbols = (await vendor("dizione-ptbr/test/model.json")).symbols;
    golden = await vendor("dizione-ptbr/test/golden.sample.json");
  });

  it("gives the reference's ids and stress for its sample sentences and edge cases", () => {
    const rows = [...golden.sentences, ...golden.edge];
    expect(rows.length).toBeGreaterThan(300);
    const different: string[] = [];
    for (const [sentence, expected] of rows) {
      // "ˈo j , <sp> t ˈu d u": a stress mark in front of a stressed phone.
      const marked = expected.split(" ");
      const result = frontEnd(sentence);
      // Where the reference has no phone at all, the engine's front end says so with null.
      const silent = marked.every((symbol) => symbols.indexOf(symbol) < 17);
      const same = silent
        ? result === null
        : JSON.stringify(result?.ids) ===
            JSON.stringify(marked.map((symbol) => symbols.indexOf(symbol.replace(/^ˈ/, "")))) &&
          JSON.stringify(result?.stress) === JSON.stringify(marked.map((symbol) => Number(symbol.startsWith("ˈ"))));
      if (!same) different.push(sentence);
    }
    // Compared with accents composed: one of these sentences stores them as separate marks.
    expect(different.map((sentence) => sentence.normalize("NFC")).toSorted()).toEqual(STALE.toSorted());
  });

  it("names the spoken words of nearly every sentence", () => {
    expect(
      named(
        frontEnd,
        golden.sentences.map(([sentence]) => sentence),
      ),
    ).toBeGreaterThan(0.95);
  });
});

describe("Italian (vocina's g2p_it)", () => {
  let frontEnd: FrontEnd;
  let vectors: { testo: string; varianti?: string[]; ids: number[]; stress: number[]; symbols: string[] }[];
  let model: { symbols: string[] };
  beforeAll(async () => {
    frontEnd = await loadFrontEnd("g2p-it", readAsset);
    // Vectors with optional readings switched on are for a setting the add-on does not use.
    vectors = (await vendor("vocina/vettori.json")).vettori.filter(
      (vector: { varianti?: string[] }) => !vector.varianti?.length,
    );
    model = await vendor("vocina/model.json");
  });

  it("gives the reference's ids and stress for every test vector", () => {
    expect(vectors.length).toBeGreaterThan(300);
    for (const vector of vectors) {
      const result = frontEnd(vector.testo);
      // A text with nothing to say is only <bos> and <eos> in the reference, and null here.
      if (!result)
        expect(vector.symbols.length, vector.testo).toBeLessThanOrEqual(
          2 + vector.symbols.filter((s) => s.length === 1 && !/\p{L}/u.test(s)).length,
        );
      else {
        expect(result.ids, vector.testo).toEqual(vector.ids);
        expect(result.stress, vector.testo).toEqual(vector.stress);
      }
    }
  });

  it("uses the symbol table the released model was trained with", () => {
    for (const vector of vectors)
      expect(vector.symbols.map((symbol) => model.symbols.indexOf(symbol))).toEqual(vector.ids);
  });

  it("names the spoken words of nearly every sentence", () => {
    expect(
      named(
        frontEnd,
        vectors.map((vector) => vector.testo).filter((text) => frontEnd(text)),
      ),
    ).toBeGreaterThan(0.95);
  });
});
