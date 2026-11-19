// Highlights through the CSS Custom Highlight API: ranges are registered with the document,
// and nothing in the page's DOM is touched.

export const SENTENCE_HIGHLIGHT = "tiny-reader-sentence";
export const WORD_HIGHLIGHT = "tiny-reader-word";

/**
 * Injected by the background with scripting.insertCSS (no <style> element, and a page CSP
 * does not apply). System colours follow the page's light or dark scheme and forced colours.
 * Only colours: Firefox 140–145 ignore text-decoration in ::highlight().
 */
export const HIGHLIGHT_CSS = `
::highlight(${SENTENCE_HIGHLIGHT}) { background-color: Mark; color: MarkText; }
::highlight(${WORD_HIGHLIGHT}) { background-color: SelectedItem; color: SelectedItemText; }`;

/** Shows `range` under `name`, or clears that highlight with null. */
function show(name: string, range: Range | null, priority: number) {
	if (!range) {
		CSS.highlights.delete(name);
		return;
	}
	const highlight = new Highlight(range);
	highlight.priority = priority;
	CSS.highlights.set(name, highlight);
}

/** The sentence being read. */
export const highlightSentence = (range: Range | null) =>
	show(SENTENCE_HIGHLIGHT, range, 0);
/** The word being spoken, painted over the sentence. */
export const highlightWord = (range: Range | null) =>
	show(WORD_HIGHLIGHT, range, 1);
