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

/** Where a stretch of the built text comes from: `length` characters of one run, from `start`. */
export interface PdfRun {
  /** Where the stretch starts in the built text. */
  textStart: number;
  page: number;
  /** Index of the run among its page's runs. */
  item: number;
  /** Where the stretch starts in the run's `str`. */
  start: number;
  length: number;
}

export interface PdfText {
  /** The document's paragraphs, separated by "\n". */
  text: string;
  /** In text order, which is also the order of the runs. Joining spaces belong to no run. */
  runs: PdfRun[];
}

/** A word taken from one run, or a space that joins two (`item` -1). */
interface Piece {
  text: string;
  page: number;
  item: number;
  start: number;
}

interface Line {
  pieces: Piece[];
  text: string;
  y: number;
  height: number;
  page: number;
  /** White space was seen since the last word. */
  gap: boolean;
}

const SPACE: Piece = { text: " ", page: -1, item: -1, start: 0 };
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
  for (const [index, item] of items.entries()) {
    // A new baseline starts a new line. Half a line of slack keeps superscripts on theirs.
    if (current && item.str.trim() && Math.abs(item.y - current.y) > Math.max(current.height, item.height) * 0.5)
      close();
    if (!current) {
      if (!item.str.trim()) continue;
      current = { pieces: [], text: "", y: item.y, height: item.height, page, gap: false };
    }
    const line: Line = current;
    // Words keep their place in the run; any white space between them becomes one space.
    let end = 0;
    for (const word of item.str.matchAll(/\S+/g)) {
      if (word.index > end) line.gap = true;
      if (line.gap && line.pieces.length) line.pieces.push(SPACE);
      line.gap = false;
      line.pieces.push({ text: word[0], page, item: index, start: word.index });
      end = word.index + word[0].length;
    }
    if (end < item.str.length) line.gap = true;
    line.height = Math.max(line.height, item.height);
    if (item.hasEOL) close();
  }
  close();
  return lines
    .map((line) => ({ ...line, text: line.pieces.map((piece) => piece.text).join("") }))
    .filter((line) => line.text && !PAGE_NUMBER.test(line.text));
}

/**
 * The text of a document, given the text runs of each page in reading order, with the way back
 * from that text to the runs.
 *
 * A paragraph ends at a wide vertical gap, at a change of font size (a heading), and at a page
 * break unless the sentence visibly runs on. Lines are joined with a space, or with nothing
 * when a word was hyphenated across the line end.
 *
 * ponytail: single-column prose only. Columns, tables, footnotes and running headers are read
 * in whatever order pdf.js reports them; a hyphenated compound split at a line end loses its
 * hyphen. Use page geometry (column detection, repeated header lines) if that matters.
 */
export function pdfText(pages: TextItem[][]): PdfText {
  const paragraphs: { text: string; pieces: Piece[] }[] = [];
  let previous: Line | null = null;
  for (const line of pages.flatMap(linesOf)) {
    const paragraph = paragraphs.at(-1);
    const last = paragraph?.text ?? "";
    const tallest = Math.max(previous?.height ?? 0, line.height) || 12;
    const runsOn = !ENDS_SENTENCE.test(last) && STARTS_LOWER.test(line.text);
    const sameBlock =
      previous !== null &&
      (previous.page === line.page
        ? Math.abs(previous.height - line.height) <= tallest * 0.15 &&
          previous.y - line.y > 0 &&
          previous.y - line.y <= tallest * 1.6
        : runsOn);
    const hyphen = paragraph?.pieces.at(-1);
    if (!paragraph || !sameBlock) paragraphs.push({ text: line.text, pieces: [...line.pieces] });
    else if (hyphen && /\p{L}-$/u.test(last) && STARTS_LOWER.test(line.text)) {
      paragraph.pieces[paragraph.pieces.length - 1] = { ...hyphen, text: hyphen.text.slice(0, -1) };
      paragraph.pieces.push(...line.pieces);
      paragraph.text = last.slice(0, -1) + line.text;
    } else {
      paragraph.pieces.push(SPACE, ...line.pieces);
      paragraph.text = `${last} ${line.text}`;
    }
    previous = line;
  }

  let text = "";
  const runs: PdfRun[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index) text += "\n";
    for (const { text: piece, page, item, start } of paragraph.pieces) {
      if (item >= 0 && piece) runs.push({ textStart: text.length, page, item, start, length: piece.length });
      text += piece;
    }
  }
  return { text, runs };
}
