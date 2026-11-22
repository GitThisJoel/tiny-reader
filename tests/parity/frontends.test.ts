// The front ends for other languages against their own references: the token ids and stress
// values each project's Python original produces, as recorded in files that come with its
// JavaScript port. These files are fetched by `pnpm fetch-assets`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { espeakVersion } from "../../engine/espeak.ts";
import { loadFrontEnd } from "../../engine/frontends.ts";
import { type SyncFrontEnd as FrontEnd, loadSyncFrontEnd, readAsset } from "../assets.ts";

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
    frontEnd = await loadSyncFrontEnd("dizione-ptbr");
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
    frontEnd = await loadSyncFrontEnd("g2p-it");
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

// Spanish and French: each model's own Python front end, run with a native eSpeak NG 1.52.0
// built from the same source as the wasm one, over tests/parity/espeak-sentences.json. The
// reference files are written by `pnpm build-espeak --fixtures`.
describe.each([
  ["European Spanish", "espeak-es", "es", "tiny-voca-es/model.json"],
  ["French", "espeak-fr", "fr", "tiny-voca-fr/model.json"],
])("%s (eSpeak NG)", (_, name, language, descriptor) => {
  let frontEnd: FrontEnd;
  let reference: {
    espeak: string;
    symbols: string[];
    sentences: { text: string; ids?: number[]; stress?: number[] }[];
  };
  let model: { symbols: string[] };
  beforeAll(async () => {
    frontEnd = await loadSyncFrontEnd(name);
    reference = JSON.parse(await readFile(join(import.meta.dirname, `espeak-${language}.json`), "utf8"));
    model = await vendor(descriptor);
  });

  it("gives the ids and stress of the Python front end with native eSpeak NG 1.52.0", async () => {
    expect(reference.espeak).toContain("1.52.0");
    expect(await espeakVersion(readAsset)).toContain("1.52.0");
    expect(reference.sentences.length).toBeGreaterThanOrEqual(50);
    for (const sentence of reference.sentences) {
      const result = frontEnd(sentence.text);
      expect(result?.ids, sentence.text).toEqual(sentence.ids);
      expect(result?.stress, sentence.text).toEqual(sentence.stress);
    }
  });

  it("uses the symbol table the released model was trained with", () => {
    expect(reference.symbols).toEqual(model.symbols);
  });

  // How many, not whether each name is the right one: eSpeak NG does not say which word it read, so
  // there is nothing to compare a name with. The names are right when the counts agree for the right reason.
  it("gives a name to the words of most pieces of text", () => {
    const words = reference.sentences.flatMap((sentence) => frontEnd(sentence.text)?.words ?? []);
    // These sentences are full of numbers, dates and amounts, whose pieces stay nameless.
    expect(words.filter((word) => word.text).length / words.length).toBeGreaterThan(0.7);
  });
});

describe("eSpeak NG, one instance for every voice", () => {
  it("gives each language's reference ids when the voices take turns", async () => {
    const turns = await Promise.all(
      (["es", "fr"] as const).map(async (language) => ({
        frontEnd: await loadFrontEnd(`espeak-${language}`, readAsset),
        sentences: JSON.parse(await readFile(join(import.meta.dirname, `espeak-${language}.json`), "utf8"))
          .sentences as { text: string; ids?: number[] }[],
      })),
    );
    for (let index = 0; index < 10; index++)
      for (const { frontEnd, sentences } of turns) {
        const sentence = sentences[index];
        expect((await frontEnd(sentence?.text ?? ""))?.ids, sentence?.text).toEqual(sentence?.ids);
      }
  });

  it("leaves a piece nameless where digit groups and a longer number could make the counts agree by accident", async () => {
    const french = await loadFrontEnd("espeak-fr", readAsset);
    // "1 000 000 000" is four written words and two spoken, "100 %" one written and three spoken.
    const words = (await french("Il y a 1 000 000 000 soit 100 % de plus."))?.words ?? [];
    expect(words.length).toBeGreaterThan(5);
    expect(words.every((word) => word.text === "")).toBe(true);
  });
});
