import type { AudioSink, Utterance } from "./reader.ts";

interface Item {
	source: AudioBufferSourceNode;
	startTime: number;
	started: boolean;
	onStart(): void;
	onEnd(): void;
}

/** How long to wait for the browser to start audio before deciding it wants a gesture. */
const RESUME_TIMEOUT_MS = 500;

/**
 * Plays utterances back to back on one AudioContext. Each is scheduled on the audio clock at
 * the exact sample where the previous one ends, so there is no gap or overlap between them.
 */
export class WebAudioSink implements AudioSink {
	private context: AudioContext | null = null;
	private items: Item[] = [];
	private nextTime = 0;

	enqueue(utterance: Utterance, onStart: () => void, onEnd: () => void) {
		const context = this.open();
		const buffer = context.createBuffer(
			1,
			utterance.pcm.length,
			utterance.sampleRate,
		);
		// Not getChannelData(0).set(pcm): that array belongs to the page, and page code may not
		// read a content script's array ("Permission denied to access object").
		buffer.copyToChannel(utterance.pcm as Float32Array<ArrayBuffer>, 0);
		const source = new AudioBufferSourceNode(context, { buffer });
		source.connect(context.destination);
		const startTime = Math.max(context.currentTime, this.nextTime);
		source.start(startTime);
		this.nextTime = startTime + buffer.duration;

		const item: Item = { source, startTime, started: false, onStart, onEnd };
		this.items.push(item);
		source.onended = () => {
			const at = this.items.indexOf(item);
			if (at < 0) return;
			this.items.splice(at, 1);
			this.start(this.items[0]);
			item.onEnd();
		};
		// Nothing before it: it sounds now. Otherwise it starts when its predecessor ends.
		if (this.items[0] === item) this.start(item);
	}

	private start(item: Item | undefined) {
		if (!item || item.started) return;
		item.started = true;
		item.onStart();
	}

	/** Seconds into the utterance that is being heard now. */
	get position(): number {
		const [item] = this.items;
		if (!item || !this.context) return 0;
		// currentTime runs ahead of the speakers by the output latency.
		return Math.max(
			0,
			this.context.currentTime -
				(this.context.outputLatency || 0) -
				item.startTime,
		);
	}

	clear() {
		const items = this.items;
		this.items = [];
		this.nextTime = 0;
		for (const { source } of items) {
			source.onended = null;
			source.stop();
			source.disconnect();
		}
	}

	pause() {
		void this.context?.suspend();
	}

	async resume() {
		const context = this.open();
		// Without a user gesture on the page, resume() stays pending instead of failing.
		await Promise.race([
			context.resume().catch(() => {}),
			new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
		]);
		return context.state === "running";
	}

	close() {
		this.clear();
		void this.context?.close();
		this.context = null;
	}

	private open() {
		this.context ??= new AudioContext();
		return this.context;
	}
}
