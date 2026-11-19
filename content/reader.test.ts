import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, type SynthOptions } from "@/engine/protocol.ts";
import {
	type AudioSink,
	Reader,
	type ReaderState,
	type Utterance,
} from "./reader.ts";

class FakeSink implements AudioSink {
	items: {
		utterance: Utterance;
		started: boolean;
		onStart(): void;
		onEnd(): void;
	}[] = [];
	cleared = 0;
	paused = false;
	/** false: the browser wants a click before audio may start. */
	allow = true;

	enqueue(utterance: Utterance, onStart: () => void, onEnd: () => void) {
		const item = { utterance, started: false, onStart, onEnd };
		this.items.push(item);
		if (this.items[0] === item) this.start();
	}
	private start() {
		const [item] = this.items;
		if (!item || item.started) return;
		item.started = true;
		item.onStart();
	}
	/** The sentence that is sounding reaches its end. */
	finish() {
		const item = this.items.shift();
		if (!item) throw new Error("nothing is playing");
		this.start();
		item.onEnd();
	}
	clear() {
		this.items = [];
		this.cleared += 1;
	}
	pause() {
		this.paused = true;
	}
	async resume() {
		this.paused = false;
		return this.allow;
	}
	get queued() {
		return this.items.map((item) => item.utterance.pcm[0]);
	}
}

interface Call {
	text: string;
	options: SynthOptions;
	signal: AbortSignal;
	resolve(): void;
	reject(error: unknown): void;
}

const tick = () => new Promise((resolve) => setTimeout(resolve));
const SENTENCES = ["s0", "s1", "s2", "s3", "s4"];
const engineError = (code: string, message = code) =>
	Object.assign(new Error(message), { code });

function setup(sentences = SENTENCES, prefetch = 2) {
	const sink = new FakeSink();
	const calls: Call[] = [];
	const states: ReaderState[] = [];
	const reader = new Reader(
		{
			sink,
			prefetch,
			onState: (state) => states.push(state),
			synthesize: (text, options, signal) =>
				new Promise<Utterance>((resolve, reject) => {
					// The first sample carries the sentence number, so tests can tell audio apart.
					const pcm = new Float32Array([sentences.indexOf(text)]);
					calls.push({
						text,
						options,
						signal,
						resolve: () => resolve({ pcm, sampleRate: 24000, words: [] }),
						reject,
					});
				}),
		},
		DEFAULT_OPTIONS,
	);
	/** The latest unsettled request for a sentence. */
	const call = (text: string) => {
		const found = calls.findLast((candidate) => candidate.text === text);
		if (!found) throw new Error(`no request for ${text}`);
		return found;
	};
	const settle = async (text: string, error?: unknown) => {
		if (error) call(text).reject(error);
		else call(text).resolve();
		await tick();
	};
	const status = () => `${reader.state.status} ${reader.state.index}`;
	return { reader, sink, calls, states, call, settle, status };
}

describe("Reader", () => {
	it("synthesizes ahead and shows loading until the first sentence sounds", async () => {
		const { reader, sink, calls, settle, status } = setup();
		reader.read(SENTENCES);
		await tick();
		expect(calls.map((call) => call.text)).toEqual(["s0", "s1", "s2"]);
		expect(status()).toBe("loading 0");
		await settle("s0");
		expect(status()).toBe("playing 0");
		expect(reader.state.utterance?.pcm[0]).toBe(0);
		await settle("s1");
		await settle("s2");
		// Only the sentence playing and the one after it are scheduled.
		expect(sink.queued).toEqual([0, 1]);
	});

	it("moves to the next sentence without a loading gap and keeps the window filled", async () => {
		const { reader, sink, calls, states, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		await settle("s1");
		await settle("s2");
		states.length = 0;
		sink.finish();
		expect(status()).toBe("playing 1");
		expect(states.map((state) => state.status)).not.toContain("loading");
		expect(calls.map((call) => call.text)).toEqual(["s0", "s1", "s2", "s3"]);
		expect(sink.queued).toEqual([1, 2]);
	});

	it("shows loading when playback catches up with synthesis", async () => {
		const { reader, sink, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		sink.finish();
		expect(status()).toBe("loading 1");
		await settle("s1");
		expect(status()).toBe("playing 1");
	});

	it("handles results that arrive out of order", async () => {
		const { reader, sink, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s2");
		await settle("s1");
		expect(sink.queued).toEqual([]);
		await settle("s0");
		expect(sink.queued).toEqual([0, 1]);
		expect(status()).toBe("playing 0");
	});

	it("finishes after the last sentence", async () => {
		const { reader, sink, settle, status } = setup(["s0", "s1"]);
		reader.read(["s0", "s1"]);
		await settle("s0");
		await settle("s1");
		sink.finish();
		sink.finish();
		expect(status()).toBe("done 2");
	});

	it("pauses and resumes", async () => {
		const { reader, sink, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		reader.pause();
		expect(sink.paused).toBe(true);
		expect(status()).toBe("paused 0");
		await reader.toggle();
		expect(sink.paused).toBe(false);
		expect(status()).toBe("playing 0");
	});

	it("reports blocked audio, keeps synthesizing, and starts on play", async () => {
		const { reader, sink, calls, settle, status } = setup();
		sink.allow = false;
		reader.read(SENTENCES);
		await settle("s0");
		expect(calls).toHaveLength(3);
		expect(status()).toBe("blocked 0");
		sink.allow = true;
		await reader.toggle();
		expect(status()).toBe("playing 0");
	});

	it("skip forward aborts stale work, reuses what was prefetched, and plays at once", async () => {
		const { reader, sink, calls, call, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s1");
		const first = call("s0");
		reader.next();
		expect(first.signal.aborted).toBe(true);
		expect(call("s2").signal.aborted).toBe(false);
		expect(sink.cleared).toBeGreaterThan(0);
		expect(status()).toBe("playing 1");
		// s1 was not requested again; s3 entered the window.
		expect(calls.map((item) => item.text)).toEqual(["s0", "s1", "s2", "s3"]);
		first.resolve();
		await tick();
		expect(sink.queued).toEqual([1]);
	});

	it("skip while playing drops the scheduled audio and replays from the target", async () => {
		const { reader, sink, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		await settle("s1");
		await settle("s2");
		expect(sink.queued).toEqual([0, 1]);
		reader.next();
		expect(sink.queued).toEqual([1, 2]);
		expect(status()).toBe("playing 1");
	});

	it("skip back requests the earlier sentence again", async () => {
		const { reader, sink, calls, settle, status } = setup();
		reader.read(SENTENCES, 2);
		await settle("s2");
		expect(status()).toBe("playing 2");
		reader.previous();
		expect(status()).toBe("loading 1");
		expect(calls.at(-1)?.text).toBe("s1");
		await settle("s1");
		expect(sink.queued).toEqual([1, 2]);
		reader.previous();
		reader.previous();
		expect(reader.state.index).toBe(0);
	});

	it("skipping past the end finishes", async () => {
		const { reader, settle, status } = setup(["s0"]);
		reader.read(["s0"]);
		await settle("s0");
		reader.next();
		expect(status()).toBe("done 1");
	});

	it("stop aborts everything in flight and ignores late results", async () => {
		const { reader, sink, calls, states } = setup();
		reader.read(SENTENCES);
		await tick();
		reader.stop();
		expect(calls.every((call) => call.signal.aborted)).toBe(true);
		states.length = 0;
		for (const call of calls) call.resolve();
		await tick();
		expect(sink.queued).toEqual([]);
		expect(states).toEqual([]);
	});

	it("new options restart the current sentence with them", async () => {
		const { reader, sink, calls, call, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		await settle("s1");
		sink.finish();
		const stale = call("s2");
		const fast = { ...DEFAULT_OPTIONS, speed: 2 };
		reader.setOptions(fast);
		expect(stale.signal.aborted).toBe(true);
		expect(sink.queued).toEqual([]);
		expect(status()).toBe("loading 1");
		expect(
			calls.slice(-3).map((item) => [item.text, item.options.speed]),
		).toEqual([
			["s1", 2],
			["s2", 2],
			["s3", 2],
		]);
		await settle("s1");
		expect(status()).toBe("playing 1");
	});

	it("skips sentences with nothing to pronounce", async () => {
		const { reader, sink, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0", engineError("nothing-to-pronounce"));
		expect(status()).toBe("loading 1");
		await settle("s1");
		expect(status()).toBe("playing 1");
		await settle("s2", engineError("nothing-to-pronounce"));
		await settle("s3");
		sink.finish();
		expect(status()).toBe("playing 3");
	});

	it("says so when nothing at all could be read", async () => {
		const { reader, settle } = setup(["s0", "s1"]);
		reader.read(["s0", "s1"]);
		await settle("s0", engineError("nothing-to-pronounce"));
		await settle("s1", engineError("nothing-to-pronounce"));
		expect(reader.state).toMatchObject({
			status: "error",
			message: expect.stringContaining("English"),
		});
	});

	it("retries once when the engine went away, then gives up", async () => {
		const { reader, calls, settle, status } = setup();
		reader.read(SENTENCES);
		await settle("s0", engineError("disconnected"));
		expect(calls.filter((call) => call.text === "s0")).toHaveLength(2);
		expect(status()).toBe("loading 0");
		await settle(
			"s0",
			engineError("disconnected", "The speech engine stopped."),
		);
		expect(reader.state).toMatchObject({
			status: "error",
			message: "The speech engine stopped.",
		});
	});

	it("stops with the message on any other failure and aborts the rest", async () => {
		const { reader, sink, calls, settle } = setup();
		reader.read(SENTENCES);
		await settle("s0");
		await settle("s1", engineError("failed", "model exploded"));
		expect(reader.state).toMatchObject({
			status: "error",
			message: "model exploded",
		});
		expect(sink.queued).toEqual([]);
		expect(calls.find((call) => call.text === "s2")?.signal.aborted).toBe(true);
		reader.next();
		expect(reader.state.status).toBe("error");
	});

	it("reports a playback failure instead of hanging", async () => {
		const { reader, sink, settle } = setup();
		sink.enqueue = () => {
			throw new Error("Permission denied to access object");
		};
		reader.read(SENTENCES);
		await settle("s0");
		expect(reader.state).toMatchObject({
			status: "error",
			message: "Permission denied to access object",
		});
	});

	it("read() replaces a reading in progress", async () => {
		const { reader, calls, settle, status } = setup();
		reader.read(SENTENCES);
		await tick();
		const old = [...calls];
		reader.read(["s3", "s4"]);
		expect(old.every((call) => call.signal.aborted)).toBe(true);
		await settle("s3");
		expect(status()).toBe("playing 0");
		expect(reader.state.total).toBe(2);
	});
});
