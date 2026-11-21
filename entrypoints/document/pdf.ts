// Shows a PDF with pdf.js: each page drawn on a canvas, with its text laid over it, invisible,
// in a text layer. The highlight is painted on that text. The file never leaves the page: it
// is parsed here, in a Worker.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfText, type TextItem } from "@/content/pdf-text.ts";
import type { Run } from "@/content/text-map.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Pages are not drawn larger than this many CSS pixels per PDF point, however wide the window. */
const MAX_SCALE = 1.6;

export interface ShownPdf {
  /** The document's text for reading, paragraphs separated by "\n". */
  text: string;
  /** Where that text sits in the pages' text layers. */
  runs: Run[];
  /** Takes the pages away and frees the document. */
  close(): void;
}

interface PageView {
  page: pdfjs.PDFPageProxy;
  canvas: HTMLCanvasElement;
  visible: boolean;
  task?: pdfjs.RenderTask;
  /** Counts draw requests, so an overtaken one can step aside. */
  turn: number;
}

/**
 * Adds the pages of the PDF in `data` to `container`.
 *
 * ponytail: every page's text layer is built before reading can start; only the drawing waits
 * for a page to come near the window. Build text layers on demand if long books open too slowly.
 * Fonts the PDF does not embed are drawn with the system's, and JPEG 2000 and JBIG2 images are
 * left out: pdf.js's font files and wasm decoders are not bundled.
 */
export async function showPdf(
  data: ArrayBuffer,
  container: HTMLElement,
  onPage: (page: number, pages: number) => void,
): Promise<ShownPdf> {
  // Nothing fetched: no data files, no wasm decoders.
  const loading = pdfjs.getDocument({ data, useWorkerFetch: false, useWasm: false });
  const views = new Map<Element, PageView>();
  let widest = 1;
  const scale = () => Number(container.style.getPropertyValue("--total-scale-factor")) || 1;
  const fitWidth = () =>
    container.style.setProperty(
      "--total-scale-factor",
      String(Math.max(0.25, Math.min(MAX_SCALE, (container.parentElement?.clientWidth ?? 0) / widest))),
    );

  async function draw(view: PageView) {
    const mine = ++view.turn;
    view.task?.cancel();
    // pdf.js refuses a canvas that another drawing still holds.
    await view.task?.promise.catch(() => {});
    if (mine !== view.turn || !view.visible) return;
    const viewport = view.page.getViewport({ scale: scale() * devicePixelRatio });
    view.canvas.width = Math.floor(viewport.width);
    view.canvas.height = Math.floor(viewport.height);
    view.task = view.page.render({ canvas: view.canvas, viewport });
    view.task.promise.catch(() => {}); // cancelled, or a page pdf.js cannot draw: its text is still read
  }
  // Pages are drawn when they come within a window's height of the view, and let go after.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const view = views.get(entry.target);
        if (!view || view.visible === entry.isIntersecting) continue;
        view.visible = entry.isIntersecting;
        if (view.visible) void draw(view);
        else {
          view.turn++;
          view.task?.cancel();
          view.canvas.width = view.canvas.height = 0;
        }
      }
    },
    { rootMargin: "100% 0px" },
  );
  let resized = 0;
  const onResize = () => {
    clearTimeout(resized);
    resized = window.setTimeout(() => {
      fitWidth();
      for (const view of views.values()) if (view.visible) void draw(view);
    }, 150);
  };
  function close() {
    removeEventListener("resize", onResize);
    clearTimeout(resized);
    observer.disconnect();
    for (const view of views.values()) view.task?.cancel();
    container.remove();
    void loading.destroy();
  }

  try {
    const pdf = await loading.promise;
    const items: TextItem[][] = [];
    const spans: HTMLElement[][] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      onPage(number, pdf.numPages);
      const page = await pdf.getPage(number);
      const size = page.getViewport({ scale: 1 });
      if (number === 1) {
        widest = size.width;
        fitWidth();
        addEventListener("resize", onResize);
      }
      const section = document.createElement("section");
      section.className = "page";
      section.ariaLabel = `Page ${number}`;
      section.style.width = `calc(var(--total-scale-factor) * ${size.width}px)`;
      section.style.height = `calc(var(--total-scale-factor) * ${size.height}px)`;
      const canvas = document.createElement("canvas");
      canvas.ariaHidden = "true"; // the text layer says what the page says
      canvas.width = canvas.height = 0; // nothing held until the page comes near
      const layer = document.createElement("div");
      layer.className = "textLayer";
      section.append(canvas, layer);

      const content = await page.getTextContent();
      const textLayer = new pdfjs.TextLayer({
        textContentSource: content,
        container: layer,
        viewport: page.getViewport({ scale: scale() }),
      });
      await textLayer.render();
      // One span per text run, in the same order as the runs given to pdfText.
      spans.push(textLayer.textDivs);
      items.push(
        content.items.flatMap((item) =>
          "str" in item
            ? [{ str: item.str, x: item.transform[4], y: item.transform[5], height: item.height, hasEOL: item.hasEOL }]
            : [],
        ),
      );
      container.append(section);
      views.set(section, { page, canvas, visible: false, turn: 0 });
      observer.observe(section);
    }
    const { text, runs } = pdfText(items);
    // What is not read, page numbers above all, is marked so the highlight of a sentence that
    // runs past it leaves it alone.
    const read = new Set(runs.map((run) => spans[run.page]?.[run.item]));
    for (const span of spans.flat()) if (!read.has(span)) span.dataset.unread = "";
    return {
      text,
      runs: runs.flatMap((run) => {
        const node = spans[run.page]?.[run.item]?.firstChild;
        return node instanceof Text
          ? [{ textStart: run.textStart, node, nodeStart: run.start, length: run.length }]
          : [];
      }),
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
