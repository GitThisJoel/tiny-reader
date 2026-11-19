/**
 * The range for "read from here": from the start of the paragraph (nearest block) that holds
 * `target` to the end of the article it is in, or of the page.
 */
export function rangeFrom(target: Element): Range {
	const view = target.ownerDocument.defaultView;
	let block = target;
	while (
		block.parentElement &&
		/^(inline|contents|ruby)/.test(
			view?.getComputedStyle(block).display ?? "block",
		)
	)
		block = block.parentElement;
	const scope =
		block.closest("article, main, [role=main]") ?? target.ownerDocument.body;
	const range = target.ownerDocument.createRange();
	range.selectNodeContents(
		scope.contains(block) ? scope : target.ownerDocument.body,
	);
	range.setStartBefore(block);
	return range;
}
