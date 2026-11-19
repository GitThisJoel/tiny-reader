// Injected on demand into the active tab (activeTab + scripting), never declared for all sites.
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createBar } from "@/content/bar.ts";
import { Reader } from "@/content/reader.ts";
import { segment } from "@/content/segment.ts";
import { WebAudioSink } from "@/content/sink.ts";
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
		const scope = globalThis as { [LOADED]?: boolean };
		if (scope[LOADED]) return;
		scope[LOADED] = true;

		let session: Session | null = null;
		let options: SynthOptions = { ...DEFAULT_OPTIONS };

		function start(text: string) {
			session?.end();
			const sentences = segment(text);
			if (!sentences.length) return;

			const client = new EngineClient(() =>
				browser.runtime.connect({ name: PORT_NAME }),
			);
			const sink = new WebAudioSink();
			const reader = new Reader(
				{
					synthesize: (sentence, synthOptions, signal) =>
						client.synthesize(sentence, synthOptions, signal),
					sink,
					onState(state) {
						bar.update(state);
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
			if (message?.type === "read-selection")
				start(getSelection()?.toString() ?? "");
			else if (message?.type === "toggle") void session?.reader.toggle();
			else if (message?.type === "stop") session?.end();
		});
		addEventListener("pagehide", () => session?.end());
	},
});
