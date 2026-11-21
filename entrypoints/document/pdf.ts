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
  /** The drawing under way, if any. */
  task?: pdfjs.RenderTask;
  /** Counts draw requests, so an overtaken one can step aside. */
  turn: number;
}

/**
 * Adds the pages of the PDF in `data` to `container`. Gives up, with the signal's reason, when
 * `signal` is aborted before it is done.
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
  signal: AbortSignal,
): Promise<ShownPdf> {
  // Nothing fetched: no data files, no wasm decoders.
  const loading = pdfjs.getDocument({ data, useWorkerFetch: false, useWasm: false });
  const views = new Map<Element, PageView>();
  /** Width of the widest page so far, in PDF points. */
  let widest = 1;
  /** CSS pixels per PDF point. The text layers take it from the CSS variable. */
  let scale = 0;
  /** Device pixels per CSS pixel when the pages were last drawn. */
  let density = devicePixelRatio;
  /** Fits the widest page into the room there is. True when that changed the scale. */
  function fitWidth(): boolean {
    const fitted = Math.max(0.25, Math.min(MAX_SCALE, (container.parentElement?.clientWidth ?? 0) / widest));
    if (fitted === scale) return false;
    scale = fitted;
    container.style.setProperty("--total-scale-factor", String(scale));
    return true;
  }

  async function draw(view: PageView) {
    const mine = ++view.turn;
    view.task?.cancel();
    // pdf.js refuses a canvas that another drawing still holds.
    await view.task?.promise.catch(() => {});
    if (mine !== view.turn || !view.visible) return;
    const viewport = view.page.getViewport({ scale: scale * devicePixelRatio });
    view.canvas.width = Math.floor(viewport.width);
    view.canvas.height = Math.floor(viewport.height);
    const task = view.page.render({ canvas: view.canvas, viewport });
    view.task = task;
    task.promise
      .catch(() => {}) // cancelled, or a page pdf.js cannot draw: its text is still read
      .finally(() => {
        if (view.task === task) view.task = undefined;
      });
  }
  const redraw = () => {
    density = devicePixelRatio;
    for (const view of views.values()) if (view.visible) void draw(view);
  };
  // Pages are drawn when they come within a window's height of the view, and let go after.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const view = views.get(entry.target);
        if (!view || view.visible === entry.isIntersecting) continue;
        view.visible = entry.isIntersecting;
        if (view.visible) void draw(view);
        else {
          view.task?.cancel();
          view.canvas.width = view.canvas.height = 0;
          // pdf.js keeps what it needed to draw the page, decoded images included, until told.
          view.page.cleanup();
        }
      }
    },
    { rootMargin: "100% 0px" },
  );
  let resized = 0;
  const onResize = () => {
    clearTimeout(resized);
    resized = window.setTimeout(() => {
      // Nothing to do when the pages keep their size, as when only the height changed.
      if (fitWidth() || density !== devicePixelRatio) redraw();
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
    addEventListener("resize", onResize);
    const items: TextItem[][] = [];
    const spans: HTMLElement[][] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      onPage(number, pdf.numPages);
      const page = await pdf.getPage(number);
      const size = page.getViewport({ scale: 1 });
      // Pages need not be of one size: all are scaled alike, so that the widest fits.
      if (size.width > widest) {
        widest = size.width;
        if (fitWidth()) redraw();
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
        viewport: page.getViewport({ scale }),
      });
      await textLayer.render();
      // One span per text run, in the same order as the runs given to pdfText.
      spans.push(textLayer.textDivs);
      items.push(
        content.items.flatMap((item) =>
          "str" in item ? [{ str: item.str, y: item.transform[5], height: item.height, hasEOL: item.hasEOL }] : [],
        ),
      );
      container.append(section);
      views.set(section, { page, canvas, visible: false, turn: 0 });
      observer.observe(section);
    }
    const { text, runs } = pdfText(items);
    // Text that is not read, page numbers above all, is marked so the highlight of a sentence
    // that runs past it leaves it alone. Not the spaces between words, which are no run either.
    const read = new Set(runs.map((run) => spans[run.page]?.[run.item]));
    for (const span of spans.flat()) if (!read.has(span) && span.textContent?.trim()) span.dataset.unread = "";
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
