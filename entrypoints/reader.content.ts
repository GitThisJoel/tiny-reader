// Injected on demand into the active tab (activeTab + scripting), never declared for all sites.
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createBar } from "@/content/bar.ts";
import { highlightSentence, highlightWord } from "@/content/highlight.ts";
import { Reader } from "@/content/reader.ts";
import { segment } from "@/content/segment.ts";
import { WebAudioSink } from "@/content/sink.ts";
import { mapRange } from "@/content/text-map.ts";
import { WordTracker } from "@/content/word-tracker.ts";
import { EngineClient } from "@/engine/client.ts";
import {
	DEFAULT_OPTIONS,
	PORT_NAME,
	type SynthOptions,
} from "@/engine/protocol.ts";

/** Background → content script. */
export type ReaderCommand =
	| { type: "read-selection" }
	| { type: "toggle" }
	| { type: "stop" };

interface Session {
	reader: Reader;
	end(): void;
}

const LOADED = Symbol.for("tiny-reader.loaded");

export default defineContentScript({
	registration: "runtime",
	main() {
		// executeScript may run this file again in the same page; set up only once.
		// The return value tells the background whether this was the first time.
		const scope = globalThis as { [LOADED]?: boolean };
		if (scope[LOADED]) return false;
		scope[LOADED] = true;

		let session: Session | null = null;
		let options: SynthOptions = { ...DEFAULT_OPTIONS };

		function start(range: Range) {
			session?.end();
			const map = mapRange(range);
			const sentences = segment(map.text);
			if (!sentences.length) return;
			// The selection would paint over the highlight, so it is dropped.
			getSelection()?.removeAllRanges();

			const client = new EngineClient(() =>
				browser.runtime.connect({ name: PORT_NAME }),
			);
			const sink = new WebAudioSink();
			// A highlight that jumps from word to word is motion; with reduced motion only the
			// sentence is marked.
			const reducedMotion = matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			let spoken: (typeof sentences)[number] | undefined;
			const tracker = new WordTracker(
				() => sink.position,
				(word) =>
					highlightWord(
						word && spoken
							? map.rangeOf(
									spoken.start + word.charStart,
									spoken.start + word.charEnd,
								)
							: null,
					),
			);
			let followed: unknown = null;
			const reader = new Reader(
				{
					synthesize: (sentence, synthOptions, signal) =>
						client.synthesize(sentence, synthOptions, signal),
					sink,
					onState(state) {
						bar.update(state);
						const reading = state.status !== "done" && state.status !== "error";
						const sentence = reading ? sentences[state.index] : undefined;
						highlightSentence(
							sentence ? map.rangeOf(sentence.start, sentence.end) : null,
						);
						// Follow words only while this utterance is sounding.
						const utterance =
							state.status === "playing" && !reducedMotion
								? state.utterance
								: undefined;
						if (utterance !== followed) {
							followed = utterance;
							spoken = sentence;
							if (utterance) tracker.follow(utterance.words);
							else tracker.stop();
						}
						// Keep the engine loaded while reading; let Firefox unload it otherwise.
						client.keepAlive(
							state.status === "playing" || state.status === "loading",
						);
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
		}

		browser.runtime.onMessage.addListener((message: ReaderCommand) => {
			if (message?.type === "read-selection") {
				// ponytail: only the first range of a multi-range (Ctrl+drag) selection is read.
				const selection = getSelection();
				if (selection?.rangeCount && !selection.isCollapsed)
					start(selection.getRangeAt(0));
			} else if (message?.type === "toggle") void session?.reader.toggle();
			else if (message?.type === "stop") session?.end();
		});
		addEventListener("pagehide", () => session?.end());
		return true;
	},
});
