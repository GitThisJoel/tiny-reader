// Text preparation before the phonemizer. Everything here keeps character offsets intact,
// so positions in the prepared text are positions in the text the page sent.

/** Every whitespace character becomes one space. The length does not change. */
export const normalize = (text: string): string => text.replace(/\s/g, " ");

/**
 * Adds a full stop when the text ends without a mark. Without one the model cuts the last
 * word short. Same rule as `tiny_voca.infer.finished`: a face or a sign after the last word
 * is no mark ("see you :)"), a comma or a colon is one.
 */
export function finished(text: string): string {
  const body = text.replace(/\s+$/, "");
  if (!body) return text;
  const last = body.split(/\s+/).pop() ?? "";
  const marked = /[\p{L}\p{N}]/u.test(last)
    ? /[.!?…,;:]["'”’)\]»]*$/.test(last)
    : /[.!?…]/.test(last) || /^[,;:]$/.test(last);
  return marked ? text : `${body}.`;
}

export interface Piece {
  text: string;
  /** Where the piece starts in the text it was cut from. */
  offset: number;
}

/**
 * Cuts `text` into pieces none of which is `tooLong`: first after `, ; : —`, then between
 * words, halving. A single word that is still too long is dropped (same as the reference).
 */
export function splitLong(text: string, tooLong: (piece: string) => boolean, offset = 0): Piece[] {
  if (!text.trim()) return [];
  if (!tooLong(text)) return [{ text, offset }];
  // Only cuts strictly inside the text count: each one leaves two shorter pieces, so this ends.
  const cutsAfter = (pattern: RegExp) =>
    [...text.matchAll(pattern)].map((match) => match.index + match[0].length).filter((cut) => cut < text.length);
  let cuts = cutsAfter(/[,;:—]\s+/g);
  if (!cuts.length) {
    const gaps = cutsAfter(/\s+/g);
    const middle = gaps[Math.floor((gaps.length - 1) / 2)];
    if (middle === undefined) return [];
    cuts = [middle];
  }
  const bounds = [0, ...cuts, text.length];
  return bounds
    .slice(0, -1)
    .flatMap((start, index) => splitLong(text.slice(start, bounds[index + 1]), tooLong, offset + start));
}
