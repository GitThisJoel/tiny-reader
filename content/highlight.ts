// Highlights through the CSS Custom Highlight API: ranges are registered with the document,
// and nothing in the page's DOM is touched.

export const SENTENCE_HIGHLIGHT = "tiny-reader-sentence";

/**
 * Injected by the background with scripting.insertCSS (no <style> element, and a page CSP
 * does not apply). System colours follow the page's light or dark scheme and forced colours.
 * Only colours: Firefox 140–145 ignore text-decoration in ::highlight().
 */
export const HIGHLIGHT_CSS = `::highlight(${SENTENCE_HIGHLIGHT}) { background-color: Mark; color: MarkText; }`;

/** Shows `range` as the sentence being read, or clears it with null. */
export function highlightSentence(range: Range | null) {
	if (range) CSS.highlights.set(SENTENCE_HIGHLIGHT, new Highlight(range));
	else CSS.highlights.delete(SENTENCE_HIGHLIGHT);
}
