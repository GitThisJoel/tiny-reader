// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rangeFrom } from "./from-here.ts";
import { mapRange } from "./text-map.ts";

const textFrom = (html: string, selector: string) => {
  document.body.innerHTML = html;
  const target = document.querySelector(selector);
  if (!target) throw new Error(selector);
  return mapRange(rangeFrom(target)).text;
};

describe("rangeFrom", () => {
  it("starts at the clicked paragraph and runs to the end of the page", () => {
    expect(textFrom("<p>One.</p><p id=t>Two.</p><p>Three.</p>", "#t")).toBe("Two.\nThree.");
  });

  it("starts at the beginning of the paragraph when an inline element was clicked", () => {
    expect(textFrom("<p>Zero.</p><p>Start <a href=#>and <em id=t>middle</em></a> end.</p><p>Next.</p>", "#t")).toBe(
      "Start and middle end.\nNext.",
    );
  });

  it("stops at the end of the enclosing article", () => {
    expect(
      textFrom(
        "<nav>Menu</nav><article><h1>Title</h1><p id=t>Body.</p><p>More.</p></article><footer>Legal</footer>",
        "#t",
      ),
    ).toBe("Body.\nMore.");
    expect(textFrom("<main><p id=t>Body.</p></main><footer>Legal</footer>", "#t")).toBe("Body.");
  });

  it("reads to the end of the page when the click was outside any article", () => {
    expect(textFrom("<p id=t>Intro.</p><article><p>Body.</p></article><footer>Legal</footer>", "#t")).toBe(
      "Intro.\nBody.\nLegal",
    );
  });

  it("works when the body itself was clicked", () => {
    expect(textFrom("<p>All of it.</p>", "body")).toBe("All of it.");
  });
});
