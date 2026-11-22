import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadSyncFrontEnd, readAsset, type SyncFrontEnd } from "../tests/assets.ts";
import { fromSymbols, keepLast, loadFrontEnd } from "./frontends.ts";
import { BUNDLED, MODELS, ModelError } from "./models.ts";

/**
 * In place of the German letter-to-sound model, which is a download: a model that hears "a" in
 * every letter. The time steps of its output are the letters; class 0 is the unit "a".
 */
const fakeNeeds = {
  ort: {
    Tensor: class {
      dims: number[];
      constructor(_type: string, _data: unknown, dims: number[]) {
        this.dims = dims;
      }
    },
    InferenceSession: {
      create: async () => ({
        release: async () => {},
        run: async ({ chars }: { chars: { dims: number[] } }) => {
          const [steps, classes] = [chars.dims[1] ?? 0, 179];
          const data = new Float32Array(steps * classes).fill(-9);
          for (let step = 0; step < steps; step++) data[step * classes + (step % 2 ? 178 : 0)] = 0;
          return { logp: { dims: [1, steps, classes], data } };
        },
      }),
    },
  },
  helper: async () => Uint8Array.of(1),
};

describe("loadFrontEnd", () => {
  it("refuses a front end this build does not have, saying which, before reading anything", async () => {
    const read = vi.fn(readAsset);
    for (const name of ["espeak-de", "", "Dizione", "toString"])
      await expect(loadFrontEnd(name, read)).rejects.toBeInstanceOf(ModelError);
    await expect(loadFrontEnd("espeak-de", read)).rejects.toThrow(
      'it needs the text front end "espeak-de", which this version of Tiny Reader does not have',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("has the front end of every model in the list", async () => {
    for (const name of new Set(MODELS.map((model) => model.frontend)))
      expect(await loadFrontEnd(name, readAsset, fakeNeeds), name).toBeTypeOf("function");
  });
});

describe.each([
  ["dizione", "Hello! It costs $42.50 today.", ["hello", "it", "costs", "forty", "two", "dollars"]],
  ["dizione-ptbr", "Oi, tudo bem? Paguei R$ 15,50 às 10h30.", ["Oi", "tudo", "bem", "Paguei", "quinze", "reais"]],
  ["g2p-it", "L'amico arriva alle 14:35, poi parte.", ["L'amico", "arriva", "alle", "quattordici"]],
  // eSpeak NG does not say which words it read: a piece is named from the text when the counts agree.
  ["espeak-es", "Hola, ¿cómo estás? Cuesta 15 euros.", ["Hola", "cómo", "estás", "Cuesta", "15", "euros"]],
  ["espeak-fr", "Bonjour, comment allez-vous ? Cela coûte 15 euros.", ["Bonjour", "comment", "allez-vous", "Cela"]],
  ["espeak-tr", "Merhaba, bugün nasılsın? Ankara'da hava güzel.", ["Merhaba", "bugün", "nasılsın", "Ankarada"]],
  ["espeak-bn", "আমি ভাত খাই। আপনার order টি আসবে।", ["আমি", "ভাত", "খাই", "আপনার", "order", "টি", "আসবে"]],
  ["espeak-ml", "ഹലോ, സുഖമാണോ? എവിടെയാണ് ഇപ്പോൾ?", ["ഹലോ", "സുഖമാണോ", "എവിടെയാണ്", "ഇപ്പോൾ"]],
])("the %s front end", (name, sentence, firstWords) => {
  let frontEnd: SyncFrontEnd;
  beforeAll(async () => {
    frontEnd = await loadSyncFrontEnd(name);
  });

  it("gives tokens between <bos> and <eos>, a stress value for each, and the words it speaks", () => {
    const spoken = frontEnd(sentence);
    if (!spoken) throw new Error("nothing");
    expect([spoken.ids[0], spoken.ids.at(-1)]).toEqual([1, 2]);
    expect(spoken.stress).toHaveLength(spoken.ids.length);
    // The Malayalam model was trained without stress.
    expect(spoken.stress.some((value) => value > 0)).toBe(name !== "espeak-ml");
    // Numbers are spoken as words, and each word owns a stretch of tokens, in order.
    expect(spoken.words.slice(0, firstWords.length).map((word) => word.text)).toEqual(firstWords);
    let previous = 1;
    for (const word of spoken.words) {
      expect(word.tokenStart).toBeGreaterThanOrEqual(previous);
      expect(word.tokenEnd).toBeGreaterThan(word.tokenStart);
      previous = word.tokenEnd;
    }
    expect(previous).toBeLessThan(spoken.ids.length);
  });

  it("gives null for text with nothing to pronounce", () => {
    for (const text of ["", "   ", "…"]) expect(frontEnd(text), JSON.stringify(text)).toBeNull();
    // eSpeak NG has something to say for any script, as when the models were trained; the others skip it.
    if (!name.startsWith("espeak")) expect(frontEnd("こんにちは世界")).toBeNull();
  });
});

describe("keepLast", () => {
  it("sets a front end up once for models that share it, and lets it go when another is asked for", async () => {
    const log: string[] = [];
    const frontEnd = keepLast(async (model) => {
      log.push(`load ${model.frontend}`);
      return Object.assign(() => null, { release: async () => void log.push(`release ${model.frontend}`) });
    });
    const english = { ...BUNDLED, frontend: "dizione" };
    const german = { ...BUNDLED, frontend: "g2p-de", helper: { url: "", size: 1, sha256: "a" } };
    expect(await frontEnd(english)).toBe(await frontEnd({ ...english, id: "another" }));
    await frontEnd(german);
    // The same front end with another helper file is not the same front end.
    await frontEnd({ ...german, helper: { url: "", size: 1, sha256: "b" } });
    await frontEnd(english);
    expect(log).toEqual([
      "load dizione",
      "load g2p-de",
      "release dizione",
      "load g2p-de",
      "release g2p-de",
      "load dizione",
      "release g2p-de",
    ]);
  });

  it("tries again after a front end could not be set up", async () => {
    let tries = 0;
    const frontEnd = keepLast(async () => {
      if (!tries++) throw new Error("no");
      return () => null;
    });
    await expect(frontEnd(BUNDLED)).rejects.toThrow("no");
    expect(await frontEnd(BUNDLED)).toBeTypeOf("function");
  });
});

describe("the German front end", () => {
  it("is refused while its letter-to-sound model is not downloaded", async () => {
    for (const needs of [{}, { ...fakeNeeds, helper: async () => null }])
      await expect(loadFrontEnd("g2p-de", readAsset, needs)).rejects.toThrow(
        new ModelError("its letter-to-sound model is not downloaded"),
      );
  });

  it("writes numbers out, reads known words from its table and the others with the model, and keeps each word", async () => {
    const frontEnd = await loadFrontEnd("g2p-de", readAsset, fakeNeeds);
    const spoken = await frontEnd("Hallo, der Zug fährt um 14:35 Uhr.");
    if (!spoken) throw new Error("nothing");
    expect([spoken.ids[0], spoken.ids.at(-1)]).toEqual([1, 2]);
    expect(spoken.words.map((word) => word.text)).toEqual([
      "Hallo",
      "der",
      "Zug",
      "fährt",
      "um",
      "vierzehn",
      "Uhr",
      "fünfunddreißig",
    ]);
    expect(await frontEnd("…")).toBeNull();
  });
});

describe("a front end fed by eSpeak NG", () => {
  it("leaves the words of a piece nameless when eSpeak NG spoke another number of them", async () => {
    const frontEnd = await loadSyncFrontEnd("espeak-es");
    // "1250" is one word in the text and three when spoken; "Vale" stands alone before the comma.
    const spoken = frontEnd("Vale, cuesta 1250 euros.");
    expect(spoken?.words.map((word) => word.text)).toEqual(["Vale", "", "", "", "", ""]);
  });
});

describe("fromSymbols", () => {
  // <bos> a b <sp> c , <sp> d <eos> with phones from id 17 on.
  const spoken = { ids: [1, 20, 21, 3, 22, 5, 3, 23, 2], stress: [0, 1, 0, 0, 1, 0, 0, 1, 0] };

  it("takes each run of phones for one word and names it from the rewritten text", () => {
    expect(fromSymbols(spoken, "ab c, d")).toEqual({
      ...spoken,
      words: [
        { text: "ab", tokenStart: 1, tokenEnd: 3 },
        { text: "c", tokenStart: 4, tokenEnd: 5 },
        { text: "d", tokenStart: 7, tokenEnd: 8 },
      ],
    });
  });

  it("drops the words rather than guess when the text has another number of them", () => {
    expect(fromSymbols(spoken, "ab c")?.words).toEqual([]);
    expect(fromSymbols(spoken, "ab c d e")?.words).toEqual([]);
    expect(fromSymbols(spoken, "ab c")?.ids).toBe(spoken.ids);
  });

  it("takes the words' texts one by one when they are given, and other tokens for phones when told", () => {
    const withUnknown = { ids: [1, 4, 3, 22, 2], stress: [0, 0, 0, 1, 0] };
    expect(fromSymbols(withUnknown, ["x", ""], (id) => id >= 19 || id === 4)?.words).toEqual([
      { text: "x", tokenStart: 1, tokenEnd: 2 },
      { text: "", tokenStart: 3, tokenEnd: 4 },
    ]);
  });

  it("gives null when there is no phone at all", () => {
    expect(fromSymbols({ ids: [1, 6, 2], stress: [0, 0, 0] }, ".")).toBeNull();
  });
});
