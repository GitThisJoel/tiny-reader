// Turns the text runs of a PDF into paragraphs worth reading aloud.
// A PDF stores positioned fragments, not sentences: lines have to be found, joined, and grouped.

/** One run of text as pdf.js reports it, in page units with y growing upwards. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  /** Font size of the run. Zero for some whitespace runs. */
  height: number;
  /** pdf.js saw the line end after this run. */
  hasEOL: boolean;
}

interface Line {
  text: string;
  y: number;
  height: number;
  page: number;
}

const PAGE_NUMBER = /^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const ENDS_SENTENCE = /[.!?:;]["'”’)\]]*$/;
const STARTS_LOWER = /^\p{Ll}/u;

function linesOf(items: TextItem[], page: number): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  const close = () => {
    if (current) lines.push(current);
    current = null;
  };
  for (const item of items) {
    // A new baseline starts a new line. Half a line of slack keeps superscripts on theirs.
    if (current && item.str.trim() && Math.abs(item.y - current.y) > Math.max(current.height, item.height) * 0.5)
      close();
    if (!current) {
      if (!item.str.trim()) continue;
      current = { text: "", y: item.y, height: item.height, page };
    }
    current.text += item.str;
    current.height = Math.max(current.height, item.height);
    if (item.hasEOL) close();
  }
  close();
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }))
    .filter((line) => line.text && !PAGE_NUMBER.test(line.text));
}

/**
 * The paragraphs of a document, given the text runs of each page in reading order.
 *
 * A paragraph ends at a wide vertical gap, at a change of font size (a heading), and at a page
 * break unless the sentence visibly runs on. Lines are joined with a space, or with nothing
 * when a word was hyphenated across the line end.
 *
 * ponytail: single-column prose only. Columns, tables, footnotes and running headers are read
 * in whatever order pdf.js reports them; a hyphenated compound split at a line end loses its
 * hyphen. Use page geometry (column detection, repeated header lines) if that matters.
 */
export function paragraphsOf(pages: TextItem[][]): string[] {
  const paragraphs: string[] = [];
  let previous: Line | null = null;
  for (const line of pages.flatMap(linesOf)) {
    const last = paragraphs.at(-1) ?? "";
    const tallest = Math.max(previous?.height ?? 0, line.height) || 12;
    const runsOn = !ENDS_SENTENCE.test(last) && STARTS_LOWER.test(line.text);
    const sameBlock =
      previous !== null &&
      (previous.page === line.page
        ? Math.abs(previous.height - line.height) <= tallest * 0.15 &&
          previous.y - line.y > 0 &&
          previous.y - line.y <= tallest * 1.6
        : runsOn);
    if (!sameBlock) paragraphs.push(line.text);
    else if (/\p{L}-$/u.test(last) && STARTS_LOWER.test(line.text))
      paragraphs[paragraphs.length - 1] = last.slice(0, -1) + line.text;
    else paragraphs[paragraphs.length - 1] = `${last} ${line.text}`;
    previous = line;
  }
  return paragraphs;
}
