// The text of a DOM range as one string, with a way back from offsets in that string to DOM
// positions. Reads the DOM and never changes it.

export interface Run {
  /** Where this run starts in the built text. */
  textStart: number;
  node: Text;
  /** Where this run starts in the node's data. */
  nodeStart: number;
  length: number;
}

export interface TextMap {
  /** Visible text of the range. Blocks and <br> are separated by "\n". */
  text: string;
  /** The DOM range for text.slice(start, end), or null when it covers no page text. */
  rangeOf(start: number, end: number): Range | null;
}

// Elements whose text children are not prose shown on the page.
const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "TITLE"]);
const PRESERVES_NEWLINES = /^(pre|pre-wrap|pre-line|break-spaces)$/;

/** A computed `display` that flows inside a line rather than starting a box of its own. */
export const isInlineDisplay = (display: string): boolean => /^(inline|contents|ruby)/.test(display);

export function mapRange(range: Range): TextMap {
  const window = range.startContainer.ownerDocument?.defaultView;
  if (!window) return { text: "", rangeOf: () => null };
  const view = window;
  // Computed styles are looked up once per element, which matters on long pages.
  const styles = new Map<Element, CSSStyleDeclaration>();
  const removed = new Map<Element, boolean>();
  const blocks = new Map<Element, Element | null>();

  function styleOf(element: Element): CSSStyleDeclaration {
    let style = styles.get(element);
    if (!style) {
      style = view.getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  }

  /** display: none on the element or an ancestor, or an element we never read. */
  function isRemoved(element: Element | null): boolean {
    if (!element) return false;
    let known = removed.get(element);
    if (known === undefined) {
      known = SKIPPED.has(element.tagName) || styleOf(element).display === "none" || isRemoved(element.parentElement);
      removed.set(element, known);
    }
    return known;
  }

  /** Nearest ancestor that starts its own line box (anything that is not inline). */
  function blockOf(element: Element | null): Element | null {
    if (!element) return null;
    let known = blocks.get(element);
    if (known === undefined) {
      const display = styleOf(element).display;
      // An inline-block sits in a line but lays out its own content, so it counts as a block here.
      known = isInlineDisplay(display) && display !== "inline-block" ? blockOf(element.parentElement) : element;
      blocks.set(element, known);
    }
    return known;
  }

  const runs: Run[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  let breakBefore = false;

  const root = range.commonAncestorContainer;
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(
    root,
    0x1 | 0x4, // NodeFilter.SHOW_ELEMENT | SHOW_TEXT
  );
  // Start at the range's first node instead of scanning everything before it.
  const first =
    range.startContainer.nodeType === 3
      ? range.startContainer
      : (range.startContainer.childNodes[range.startOffset] ?? range.startContainer);
  walker.currentNode = first;
  for (let node: Node | null = first; node; node = walker.nextNode()) {
    if (node !== root && range.comparePoint(node, 0) > 0) break; // past the end
    if (node.nodeType === 1) {
      if ((node as Element).tagName === "BR" && range.intersectsNode(node) && !isRemoved(node as Element))
        breakBefore = true;
      continue;
    }
    if (node.nodeType !== 3 || !range.intersectsNode(node)) continue;
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || isRemoved(parent)) continue;
    const style = styleOf(parent);
    if (style.visibility === "hidden" || style.visibility === "collapse") continue;

    const from = textNode === range.startContainer ? range.startOffset : 0;
    const to = textNode === range.endContainer ? range.endOffset : textNode.data.length;
    if (to <= from) continue;
    let data = textNode.data.slice(from, to);
    // In normal flow a newline in the source is only a space. Left alone it would read as
    // a sentence break. Replacing it keeps the length, so offsets still line up.
    if (!PRESERVES_NEWLINES.test(style.whiteSpace)) data = data.replace(/[\n\r\t\f]/g, " ");

    const block = blockOf(parent);
    if (text && (breakBefore || block !== lastBlock)) text += "\n";
    breakBefore = false;
    lastBlock = block;
    runs.push({
      textStart: text.length,
      node: textNode,
      nodeStart: from,
      length: data.length,
    });
    text += data;
  }

  return mapOf(text, runs);
}

/** The map for `text` built from `runs`, which are in text order and in document order. */
export function mapOf(text: string, runs: Run[]): TextMap {
  /** Index of the last run starting at or before `offset`. */
  function runAt(offset: number): number {
    let low = 0;
    let high = runs.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((runs[middle]?.textStart ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  return {
    text,
    rangeOf(start, end) {
      if (!runs.length || end <= start) return null;
      // The start snaps forward to real text, the end snaps back: a separator "\n"
      // belongs to no node.
      let startIndex = runAt(start);
      let startRun = runs[startIndex] as Run;
      if (start >= startRun.textStart + startRun.length) {
        startIndex += 1;
        const next = runs[startIndex];
        if (!next) return null;
        startRun = next;
      }
      const endRun = runs[runAt(end - 1)] as Run;
      const startOffset = Math.max(start, startRun.textStart) - startRun.textStart;
      const endOffset = Math.min(end - endRun.textStart, endRun.length);
      if (endRun.textStart + endOffset <= startRun.textStart + startOffset) return null;
      const result = startRun.node.ownerDocument.createRange();
      try {
        result.setStart(startRun.node, startRun.nodeStart + startOffset);
        result.setEnd(endRun.node, endRun.nodeStart + endOffset);
      } catch {
        // The page has changed this text since it was mapped. Reading goes on without a highlight here.
        return null;
      }
      return result;
    },
  };
}

/**
 * The part of an already mapped text that lies inside `range`, to the character.
 * With `fromParagraph` it starts at the beginning of the paragraph the range starts in.
 */
export function mapWithin(text: string, runs: Run[], range: Range, fromParagraph = false): TextMap {
  let from = -1;
  let to = -1;
  // ponytail: every run is tested, for each reading (0.16 s to start in a 500-page PDF). Runs
  // are in document order, so a binary search would do if documents get huge.
  let node: Text | null = null;
  let inside = false;
  for (const run of runs) {
    // The words of a line share a node: it is tested once.
    if (run.node !== node) {
      node = run.node;
      inside = range.intersectsNode(node);
    }
    if (!inside) continue;
    const start = run.node === range.startContainer ? Math.max(range.startOffset - run.nodeStart, 0) : 0;
    const end = run.node === range.endContainer ? Math.min(range.endOffset - run.nodeStart, run.length) : run.length;
    if (end <= start) continue;
    if (from < 0) from = run.textStart + start;
    to = run.textStart + end;
  }
  if (from < 0) return mapOf("", []);
  if (fromParagraph) from = text.lastIndexOf("\n", from) + 1;
  const whole = mapOf(text, runs);
  const first = from;
  return { text: text.slice(first, to), rangeOf: (start, end) => whole.rangeOf(first + start, first + end) };
}
