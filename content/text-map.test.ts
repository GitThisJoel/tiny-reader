// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { segment } from "./segment.ts";
import { mapRange } from "./text-map.ts";

function page(html: string) {
  document.body.innerHTML = html;
  const range = document.createRange();
  range.selectNodeContents(document.body);
  return mapRange(range);
}
const rangeText = (range: Range | null) => range?.toString() ?? null;
/** Start and end of `part` in `whole`. */
const span = (whole: string, part: string): [number, number] => {
  const at = whole.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${whole}"`);
  return [at, at + part.length];
};

beforeEach(() => {
  document.head.innerHTML = "";
});

describe("mapRange", () => {
  it("joins text across inline elements and links", () => {
    const map = page(`<p>The <b>quick</b> brown <a href="#">fox <i>jumps</i></a> over.</p>`);
    expect(map.text).toBe("The quick brown fox jumps over.");
    const range = map.rangeOf(...span(map.text, "quick brown fox jumps"));
    expect(rangeText(range)).toBe("quick brown fox jumps");
    expect(range?.startContainer.parentElement?.tagName).toBe("B");
    expect(range?.startOffset).toBe(0);
    expect(range?.endContainer.parentElement?.tagName).toBe("I");
    expect(range?.endOffset).toBe(5);
  });

  it("maps a range inside one text node exactly", () => {
    const map = page("<p>One two three.</p>");
    const range = map.rangeOf(...span(map.text, "two"));
    expect(range?.startContainer).toBe(range?.endContainer);
    expect([range?.startOffset, range?.endOffset]).toEqual([4, 7]);
  });

  it("separates blocks with a newline, so sentences do not run across them", () => {
    const map = page("<h1>A title</h1><p>First paragraph</p><ul><li>Item one</li><li>Item two</li></ul>");
    expect(map.text).toBe("A title\nFirst paragraph\nItem one\nItem two");
    expect(segment(map.text).map((sentence) => sentence.text)).toEqual([
      "A title",
      "First paragraph",
      "Item one",
      "Item two",
    ]);
  });

  it("separates text before, inside and after a nested block", () => {
    const map = page("<div>Before<p>Inside</p>After</div>");
    expect(map.text).toBe("Before\nInside\nAfter");
  });

  it("turns <br> into a newline", () => {
    const map = page("<p>Line one<br>Line two<br><br>Line three</p>");
    expect(map.text).toBe("Line one\nLine two\nLine three");
    expect(rangeText(map.rangeOf(...span(map.text, "Line two")))).toBe("Line two");
  });

  it("treats source newlines and tabs as spaces, keeping offsets", () => {
    const map = page("<p>It was a sunny day, and\n\t<em>nobody</em>\nminded.</p>");
    expect(map.text).toBe("It was a sunny day, and  nobody minded.");
    expect(segment(map.text)).toHaveLength(1);
    expect(rangeText(map.rangeOf(...span(map.text, "nobody minded.")))).toBe("nobody\nminded.");
  });

  it("keeps newlines where the page preserves them", () => {
    const map = page("<pre>first line\nsecond line</pre>");
    expect(map.text).toBe("first line\nsecond line");
    expect(segment(map.text)).toHaveLength(2);
  });

  it("skips hidden nodes: display none, visibility hidden, [hidden], script and style", () => {
    const map = page(
      `<p>Seen. <span style="display:none">Gone.</span><span hidden>Also gone.</span>` +
        `<span style="visibility:hidden">Invisible.</span> Seen again.</p>` +
        `<script>var x = "code";</script><style>p { color: red }</style>` +
        `<div style="display:none"><p>Nested <b>gone</b>.</p></div><p>End.</p>`,
    );
    expect(map.text).toBe("Seen.  Seen again.\nEnd.");
    expect(rangeText(map.rangeOf(...span(map.text, "Seen again.")))).toBe("Seen again.");
  });

  it("reads a visible child of an invisible parent", () => {
    const map = page(`<p style="visibility:hidden">No <span style="visibility:visible">Yes</span> no</p>`);
    expect(map.text).toBe("Yes");
  });

  it("follows a stylesheet, not only inline styles", () => {
    document.head.innerHTML = "<style>.off { display: none } .line { display: block }</style>";
    const map = page(`<p>A<span class="off">B</span><span class="line">C</span>D</p>`);
    expect(map.text).toBe("A\nC\nD");
  });

  it("skips over a hidden node inside a range", () => {
    const map = page(`<p>Start <span hidden>secret</span>end.</p>`);
    expect(map.text).toBe("Start end.");
    const range = map.rangeOf(0, map.text.length);
    expect(range?.startContainer.textContent).toBe("Start ");
    expect(range?.endContainer.textContent).toBe("end.");
  });

  it("honours a partial selection inside text nodes", () => {
    document.body.innerHTML = "<p>Hello <b>big</b> wide world.</p><p>Next one.</p>";
    const [first, second] = document.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(first?.firstChild as Text, 3); // "lo "
    range.setEnd(second?.firstChild as Text, 4); // "Next"
    const map = mapRange(range);
    expect(map.text).toBe("lo big wide world.\nNext");
    expect(rangeText(map.rangeOf(0, 6))).toBe("lo big");
    expect(map.rangeOf(0, 2)?.startOffset).toBe(3);
    expect(rangeText(map.rangeOf(...span(map.text, "Next")))).toBe("Next");
  });

  it("handles a selection whose ends are element boundaries", () => {
    document.body.innerHTML = "<p>Zero</p><p>One</p><p>Two</p><p>Three</p>";
    const range = document.createRange();
    range.setStart(document.body, 1);
    range.setEnd(document.body, 3);
    expect(mapRange(range).text).toBe("One\nTwo");
  });

  it("handles a selection inside a single text node", () => {
    document.body.innerHTML = "<p>Just a few words here.</p>";
    const node = document.querySelector("p")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 5);
    range.setEnd(node, 16);
    const map = mapRange(range);
    expect(map.text).toBe("a few words");
    expect(rangeText(map.rangeOf(2, 5))).toBe("few");
  });

  it("snaps ranges that touch a separator to real text", () => {
    const map = page("<p>One.</p><p>Two.</p>");
    expect(map.text).toBe("One.\nTwo.");
    expect(rangeText(map.rangeOf(0, 5))).toBe("One."); // ends on the "\n"
    expect(rangeText(map.rangeOf(4, 9))).toBe("Two."); // starts on the "\n"
    expect(map.rangeOf(4, 5)).toBeNull(); // only the "\n"
    expect(map.rangeOf(3, 3)).toBeNull();
    expect(rangeText(map.rangeOf(0, 99))).toBe("One.Two.");
  });

  it("gives every sentence of a mixed page a range with the same words", () => {
    const map = page(
      `<h1>Story</h1><p>The quick <a href="#">brown fox</a> jumps. It was <em>sunny</em>,
      and nobody minded.<br>A new line!</p><p>Dr. <b>Smith</b> agreed. <span hidden>No.</span>Bye.</p>`,
    );
    const sentences = segment(map.text);
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "Story",
      "The quick brown fox jumps.",
      expect.stringMatching(/^It was sunny,\s+and nobody minded\.$/),
      "A new line!",
      "Dr. Smith agreed.",
      "Bye.",
    ]);
    const squash = (value: string | null) => value?.replace(/\s+/g, " ");
    for (const sentence of sentences)
      expect(squash(rangeText(map.rangeOf(sentence.start, sentence.end)))).toBe(squash(sentence.text));
  });

  it("gives null instead of throwing when the page shortened a mapped text node", () => {
    const map = page("<p>One two three four.</p><p>Five.</p>");
    const node = document.querySelector("p")?.firstChild as Text;
    node.data = "One";
    expect(map.rangeOf(...span(map.text, "three four."))).toBeNull();
    expect(rangeText(map.rangeOf(...span(map.text, "Five.")))).toBe("Five.");
  });

  it("gives an empty map for an empty or fully hidden range", () => {
    expect(page("").text).toBe("");
    expect(page("<p hidden>Nothing</p>").rangeOf(0, 5)).toBeNull();
  });
});
