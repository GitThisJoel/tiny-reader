// The text of a DOM range as one string, with a way back from offsets in that string to DOM
// positions. Reads the DOM and never changes it.

interface Run {
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
const SKIPPED = new Set([
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEMPLATE",
	"TEXTAREA",
	"SELECT",
	"TITLE",
]);
const PRESERVES_NEWLINES = /^(pre|pre-wrap|pre-line|break-spaces)$/;

export function mapRange(range: Range): TextMap {
	const view = range.startContainer.ownerDocument?.defaultView;
	if (!view) return { text: "", rangeOf: () => null };
	// Computed styles are looked up once per element, which matters on long pages.
	const removed = new Map<Element, boolean>();
	const blocks = new Map<Element, Element | null>();

	/** display: none on the element or an ancestor, or an element we never read. */
	function isRemoved(element: Element | null): boolean {
		if (!element) return false;
		let known = removed.get(element);
		if (known === undefined) {
			known =
				SKIPPED.has(element.tagName) ||
				view?.getComputedStyle(element).display === "none" ||
				isRemoved(element.parentElement);
			removed.set(element, known);
		}
		return known;
	}

	/** Nearest ancestor that starts its own line box (anything that is not inline). */
	function blockOf(element: Element | null): Element | null {
		if (!element) return null;
		let known = blocks.get(element);
		if (known === undefined) {
			const display = view?.getComputedStyle(element).display ?? "";
			known =
				/^(inline|contents|ruby)/.test(display) && display !== "inline-block"
					? blockOf(element.parentElement)
					: element;
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
			: (range.startContainer.childNodes[range.startOffset] ??
				range.startContainer);
	walker.currentNode = first;
	for (let node: Node | null = first; node; node = walker.nextNode()) {
		if (node !== root && range.comparePoint(node, 0) > 0) break; // past the end
		if (node.nodeType === 1) {
			if (
				(node as Element).tagName === "BR" &&
				range.intersectsNode(node) &&
				!isRemoved(node as Element)
			)
				breakBefore = true;
			continue;
		}
		if (node.nodeType !== 3 || !range.intersectsNode(node)) continue;
		const textNode = node as Text;
		const parent = textNode.parentElement;
		if (!parent || isRemoved(parent)) continue;
		const style = view.getComputedStyle(parent);
		if (style.visibility === "hidden" || style.visibility === "collapse")
			continue;

		const from = textNode === range.startContainer ? range.startOffset : 0;
		const to =
			textNode === range.endContainer ? range.endOffset : textNode.data.length;
		if (to <= from) continue;
		let data = textNode.data.slice(from, to);
		// In normal flow a newline in the source is only a space. Left alone it would read as
		// a sentence break. Replacing it keeps the length, so offsets still line up.
		if (!PRESERVES_NEWLINES.test(style.whiteSpace))
			data = data.replace(/[\n\r\t\f]/g, " ");

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
			const startOffset =
				Math.max(start, startRun.textStart) - startRun.textStart;
			const endOffset = Math.min(end - endRun.textStart, endRun.length);
			if (endRun.textStart + endOffset <= startRun.textStart + startOffset)
				return null;
			const result = startRun.node.ownerDocument.createRange();
			result.setStart(startRun.node, startRun.nodeStart + startOffset);
			result.setEnd(endRun.node, endRun.nodeStart + endOffset);
			return result;
		},
	};
}
