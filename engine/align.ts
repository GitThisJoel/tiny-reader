// Matches the words the phonemizer speaks to the words in the source text.
// The phonemizer rewrites text before speaking it ("$42.50" becomes "forty two dollars and
// fifty cents") and keeps no positions, so the link is rebuilt here. See docs/FINDINGS.md §4.

/** A spoken word with its time span in seconds. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** A stretch of source text, text.slice(charStart, charEnd), and when it is heard. */
export interface WordTiming {
  charStart: number;
  charEnd: number;
  start: number;
  end: number;
}

interface SourceWord {
  text: string;
  start: number;
  end: number;
}

const segmenter = new Intl.Segmenter("en", { granularity: "word" });
const fold = (word: string) => word.toLowerCase().replace(/[’ʼ]/g, "'");

export function sourceWords(text: string): SourceWord[] {
  const words: SourceWord[] = [];
  for (const { segment, index, isWordLike } of segmenter.segment(text))
    if (isWordLike)
      words.push({
        text: fold(segment),
        start: index,
        end: index + segment.length,
      });
  return words;
}

/**
 * Words that are spelled the same on both sides, in order, are anchors (longest common
 * subsequence). Whatever lies between two anchors is one span: its source words share the
 * time of its spoken words, with no guessing inside. Source words that nothing was spoken
 * for get no timing.
 */
export function alignWords(text: string, spoken: TimedWord[]): WordTiming[] {
  const source = sourceWords(text);
  const said = spoken.map((word) => fold(word.text));
  const rows = source.length;
  const columns = said.length;
  // lcs[i][j]: length of the longest common subsequence of source[i..] and said[j..].
  const lcs = Array.from({ length: rows + 1 }, () => new Uint16Array(columns + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      const row = lcs[i] as Uint16Array;
      const below = lcs[i + 1] as Uint16Array;
      row[j] = source[i]?.text === said[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const timings: WordTiming[] = [];
  const span = (fromSource: number, toSource: number, fromSaid: number, toSaid: number) => {
    const first = source[fromSource];
    const last = source[toSource - 1];
    const begin = spoken[fromSaid];
    const finish = spoken[toSaid - 1];
    if (!first || !last || !begin || !finish || toSource <= fromSource || toSaid <= fromSaid) return;
    timings.push({
      charStart: first.start,
      charEnd: last.end,
      start: begin.start,
      end: finish.end,
    });
  };
  let i = 0;
  let j = 0;
  let gapSource = 0;
  let gapSaid = 0;
  while (i < rows && j < columns) {
    if (source[i]?.text === said[j]) {
      span(gapSource, i, gapSaid, j);
      span(i, i + 1, j, j + 1);
      i += 1;
      j += 1;
      gapSource = i;
      gapSaid = j;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  span(gapSource, rows, gapSaid, columns);
  return timings;
}

/**
 * The timing being heard at `seconds`: the last one that has started. It stays current
 * through short pauses and through speech with no source word, until the next one starts.
 */
export function wordAt(timings: WordTiming[], seconds: number): WordTiming | null {
  let current: WordTiming | null = null;
  for (const timing of timings) {
    if (timing.start > seconds) break;
    current = timing;
  }
  return current;
}
