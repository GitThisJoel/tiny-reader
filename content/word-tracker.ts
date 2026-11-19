import { type WordTiming, wordAt } from "@/engine/align.ts";

/**
 * Follows playback and reports the word being heard, once per change.
 * Runs on animation frames only while a sentence is playing, so it costs nothing when
 * paused, stopped, or when the tab is hidden.
 */
export class WordTracker {
	private frame = 0;
	private current: WordTiming | null = null;
	private readonly position: () => number;
	private readonly onWord: (word: WordTiming | null) => void;

	constructor(
		position: () => number,
		onWord: (word: WordTiming | null) => void,
	) {
		this.position = position;
		this.onWord = onWord;
	}

	/** Starts following `words`, replacing whatever was followed before. */
	follow(words: WordTiming[]) {
		this.stop();
		if (!words.length) return;
		const step = () => {
			const word = wordAt(words, this.position());
			if (word !== this.current) {
				this.current = word;
				this.onWord(word);
			}
			this.frame = requestAnimationFrame(step);
		};
		step();
	}

	stop() {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		if (this.current) {
			this.current = null;
			this.onWord(null);
		}
	}
}
