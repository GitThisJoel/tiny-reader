import { describe, expect, it } from "vitest";
import { malayalamFrontEnd } from "./malayalam.ts";

const words = (clause: string) => clause.split(" ").filter(Boolean);

describe("malayalamFrontEnd", () => {
  it("puts a word boundary between words and a pause token at each mark, with no stress", () => {
    const frontEnd = malayalamFrontEnd((clause) => (clause === "മഴ വീട്" ? "m_ˈa_ɻ_a v_iː_ʈ_ɨ\n" : "p_o_j_i"), words);
    const spoken = frontEnd("മഴ വീട്, പോയി.");
    // <bos> m a ɻ a <sp> v iː ʈ ɨ , p o j i . <eos>, each sound in the slot the model gave it.
    expect(spoken?.ids).toEqual([1, 32, 44, 36, 44, 3, 24, 49, 28, 61, 5, 17, 67, 37, 48, 6, 2]);
    expect(spoken?.stress.every((value) => value === 0)).toBe(true);
    expect(spoken?.words).toEqual([
      { text: "മഴ", tokenStart: 1, tokenEnd: 5 },
      { text: "വീട്", tokenStart: 6, tokenEnd: 10 },
      { text: "പോയി", tokenStart: 11, tokenEnd: 15 },
    ]);
  });

  it("ends without a trailing word boundary when the text ends without a mark", () => {
    const spoken = malayalamFrontEnd(() => "m_a", words)("മ");
    expect(spoken?.ids).toEqual([1, 32, 44, 2]);
  });

  it("finds a slot for a sound the table lacks: its nearest, its bare form, or its class", () => {
    const slotOf = (phone: string) => malayalamFrontEnd(() => phone, words)("മ")?.ids[1];
    expect(slotOf("ʈʈ")).toBe(19); // shares the slot of t, by the model's own plan
    expect(slotOf("ɻ")).toBe(36); // the English r
    expect(slotOf("mː")).toBe(32); // m, with its length dropped
    expect(slotOf("ʘ")).toBe(19); // no vowel in it: t
    expect(slotOf("ɶ̃")).toBe(43); // a vowel: the neutral one
  });

  it("cleans the text as the makers' training did: marks made plain, signs and invisible characters dropped", () => {
    const heard: string[] = [];
    const frontEnd = malayalamFrontEnd((clause) => {
      heard.push(clause);
      return "m_a";
    }, words);
    // An ellipsis and a danda end a clause like a full stop; quotes and signs are not handed to eSpeak NG.
    const spoken = frontEnd("\u201cമഴ\u201d\u2026 വീട്\u0964 50% \u200bമ");
    expect(heard).toEqual(["മഴ", "വീട്", "50 മ"]);
    expect(spoken?.ids.filter((id) => id === 6)).toHaveLength(2); // two full stops
  });

  it("keeps a number whole, and takes no language mark of eSpeak NG's for a sound", () => {
    const heard: string[] = [];
    const frontEnd = malayalamFrontEnd((clause) => {
      heard.push(clause);
      return clause.includes("Google") ? "ɲ_aː_n (en)ɡ_ˈuː_ɡ_əl(ml) u_p_a" : "m_a";
    }, words);
    frontEnd("വില 3.5, സമയം 10:30, ആകെ 10,000.");
    expect(heard).toEqual(["വില 3.5", "സമയം 10:30", "ആകെ 10,000"]);
    // ɡ uː ɡ əl: four sounds for the English word, none of them made of brackets and letters.
    expect(frontEnd("ഞാൻ Google ഉപ")?.words.map((word) => word.tokenEnd - word.tokenStart)).toEqual([3, 4, 3]);
  });

  it("leaves the words nameless when eSpeak NG spoke another number of them, and gives null for nothing", () => {
    const frontEnd = malayalamFrontEnd((clause) => (clause.trim() === "൧൨" ? "o_n_n_ɨ r_a_ɳ_ʈ_ɨ" : ""), words);
    expect(frontEnd("൧൨")?.words.map((word) => word.text)).toEqual(["", ""]);
    expect(frontEnd("…")).toBeNull();
    expect(frontEnd(" , . ")).toBeNull();
  });
});
