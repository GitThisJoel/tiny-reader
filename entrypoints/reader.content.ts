// Injected on demand into the active tab (activeTab + scripting), never declared for all sites.
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createBar } from "@/content/bar.ts";
import type { Command } from "@/content/commands.ts";
import { rangeFrom } from "@/content/from-here.ts";
import { highlightSentence, highlightWord } from "@/content/highlight.ts";
import { languageWarning, SAMPLE_LENGTH } from "@/content/language.ts";
import { Reader } from "@/content/reader.ts";
import { segment } from "@/content/segment.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/content/settings.ts";
import { WebAudioSink } from "@/content/sink.ts";
import { mapRange } from "@/content/text-map.ts";
import { WordTracker } from "@/content/word-tracker.ts";
import { EngineClient } from "@/engine/client.ts";
import { DEFAULT_OPTIONS, PORT_NAME } from "@/engine/protocol.ts";

/** Background → content script. */
export type ReaderCommand =
  | { type: Command }
  /** `target` is the id Firefox gives the element the context menu was opened on. */
  | { type: "read-from-here"; target: number };

interface Session {
  reader?: Reader;
  end(): void;
}

const LOADED = Symbol.for("tiny-reader.loaded");
/** Firefox-only: resolves the element a context menu was opened on. */
const menus = (
  browser as unknown as {
    menus?: { getTargetElement(id: number): Element | null };
  }
).menus;

export default defineContentScript({
  registration: "runtime",
  main() {
    // executeScript may run this file again in the same page; set up only once.
    // The return value tells the background whether this was the first time.
    const scope = globalThis as { [LOADED]?: boolean };
    if (scope[LOADED]) return false;
    scope[LOADED] = true;

    let session: Session | null = null;

    /** Shows a message in the bar when there is nothing to start. */
    function report(message: string) {
      session?.end();
      const end = () => {
        bar.remove();
        if (session === current) session = null;
      };
      const idle = () => {};
      const bar = createBar(
        {
          toggle: idle,
          previous: idle,
          next: idle,
          stop: end,
          setOptions: idle,
        },
        DEFAULT_OPTIONS,
      );
      bar.update({ status: "error", index: 0, total: 0, message });
      const current: Session = { end };
      session = current;
    }

    async function start(range: Range) {
      // The only await comes first, so two quick starts cannot interleave below.
      // Unreadable storage must not stop a reading: the defaults will do.
      let { prefetch, ...options } = await loadSettings().catch(() => DEFAULT_SETTINGS);
      session?.end();
      // ponytail: the whole range is mapped and segmented up front. Measured 0.4 s for
      // 10,000 paragraphs (docs/FINDINGS.md §14); map block by block if that ever hurts.
      const map = mapRange(range);
      const sentences = segment(map.text);
      if (!sentences.length) {
        report("There is no text to read here.");
        return;
      }
      // The selection would paint over the highlight, so it is dropped.
      getSelection()?.removeAllRanges();

      const client = new EngineClient(() => browser.runtime.connect({ name: PORT_NAME }));
      const sink = new WebAudioSink();
      // A highlight that jumps from word to word is motion; with reduced motion only the
      // sentence is marked.
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let spoken: (typeof sentences)[number] | undefined;
      const tracker = new WordTracker(
        () => sink.position,
        (word) =>
          highlightWord(
            word && spoken ? map.rangeOf(spoken.start + word.charStart, spoken.start + word.charEnd) : null,
          ),
      );
      let followed: unknown = null;
      let marked: (typeof sentences)[number] | undefined;
      const reader = new Reader(
        {
          synthesize: (sentence, synthOptions, signal) => client.synthesize(sentence, synthOptions, signal),
          sink,
          prefetch,
          onState(state) {
            bar.update(state);
            const reading = state.status !== "done" && state.status !== "error";
            const sentence = reading ? sentences[state.index] : undefined;
            // State is reported far more often than the sentence changes.
            if (sentence !== marked) {
              marked = sentence;
              highlightSentence(sentence ? map.rangeOf(sentence.start, sentence.end) : null);
            }
            // Follow words only while this utterance is sounding.
            const utterance = state.status === "playing" && !reducedMotion ? state.utterance : undefined;
            if (utterance !== followed) {
              followed = utterance;
              spoken = sentence;
              if (utterance) tracker.follow(utterance.words);
              else tracker.stop();
            }
            // Keep the engine loaded while reading; let Firefox unload it otherwise.
            client.keepAlive(state.status === "playing" || state.status === "loading");
            if (state.status === "done") end();
          },
        },
        options,
      );
      const bar = createBar(
        {
          toggle: () => void reader.toggle(),
          previous: () => reader.previous(),
          next: () => reader.next(),
          stop: () => end(),
          setOptions(change) {
            options = { ...options, ...change };
            reader.setOptions(options);
            // The bar's choice becomes the default for the next reading.
            void saveSettings(change);
          },
        },
        options,
      );
      let ended = false;
      function end() {
        if (ended) return;
        ended = true;
        reader.stop();
        tracker.stop();
        highlightSentence(null);
        highlightWord(null);
        sink.close();
        client.close();
        bar.remove();
        if (session === current) session = null;
      }
      const current: Session = { reader, end };
      session = current;
      reader.read(sentences.map((sentence) => sentence.text));
      // Firefox's built-in detector, run locally. English only is a limit of the model.
      browser.i18n.detectLanguage(map.text.slice(0, SAMPLE_LENGTH)).then(
        (detection) => {
          const warning = languageWarning(detection);
          if (warning && !ended) bar.notify(warning);
        },
        () => {},
      );
    }

    browser.runtime.onMessage.addListener((message: ReaderCommand) => {
      switch (message?.type) {
        case "read":
        case "read-selection": {
          // ponytail: only the first range of a multi-range (Ctrl+drag) selection is read.
          const selection = getSelection();
          if (selection?.rangeCount && !selection.isCollapsed) void start(selection.getRangeAt(0));
          // "read" with nothing selected reads the page: its article if it has one. Top frame only,
          // so a page with frames does not start several readings at once.
          else if (message.type === "read" && window === top)
            void start(rangeFrom(document.querySelector("article, main, [role=main]") ?? document.body));
          break;
        }
        case "read-from-here": {
          const target = menus?.getTargetElement(message.target);
          if (target) void start(rangeFrom(target));
          break;
        }
        case "toggle":
          void session?.reader?.toggle();
          break;
        case "next":
          session?.reader?.next();
          break;
        case "previous":
          session?.reader?.previous();
          break;
        case "stop":
          session?.end();
          break;
      }
    });
    addEventListener("pagehide", () => session?.end());
    return true;
  },
});
