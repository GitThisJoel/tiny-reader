import { describe, expect, it } from "vitest";
import { FakePort, FakeWorker } from "./fakes.ts";
import { DEFAULT_OPTIONS, type EngineResponse } from "./protocol.ts";
import { createRouter } from "./router.ts";

function setup() {
	const workers: FakeWorker[] = [];
	const router = createRouter(() => {
		const worker = new FakeWorker();
		workers.push(worker);
		return worker;
	});
	const connect = (name?: string) => {
		const port = new FakePort(name);
		router.connect(port);
		return port;
	};
	return { workers, connect };
}
const synthesize = (id: string) => ({
	type: "synthesize",
	id,
	text: "Hi.",
	options: DEFAULT_OPTIONS,
});
const result = (id: string): EngineResponse => ({
	type: "result",
	id,
	pcm: new Float32Array(1),
	sampleRate: 24000,
	words: [],
});

describe("router", () => {
	it("starts the worker on the first request, not on connect", () => {
		const { workers, connect } = setup();
		const port = connect();
		port.deliver({ type: "ping" });
		port.deliver({ type: "cancel", id: "1" });
		expect(workers).toHaveLength(0);
		port.deliver(synthesize("1"));
		port.deliver(synthesize("2"));
		expect(workers).toHaveLength(1);
	});

	it("namespaces ids per port and routes results back to their port only", () => {
		const { workers, connect } = setup();
		const a = connect();
		const b = connect();
		a.deliver(synthesize("7"));
		b.deliver(synthesize("7"));
		const worker = workers[0] as FakeWorker;
		expect(
			worker.received.map((request) => "id" in request && request.id),
		).toEqual(["0:7", "1:7"]);
		worker.reply(result("1:7"));
		expect(a.sent).toEqual([]);
		expect(b.sent).toEqual([result("7")]);
	});

	it("keeps colons inside a page's own id", () => {
		const { workers, connect } = setup();
		const port = connect();
		port.deliver(synthesize("a:b"));
		(workers[0] as FakeWorker).reply(result("0:a:b"));
		expect(port.sent).toEqual([result("a:b")]);
	});

	it("scopes cancel and cancelAll to the sending port", () => {
		const { workers, connect } = setup();
		const a = connect();
		const b = connect();
		a.deliver(synthesize("1"));
		b.deliver({ type: "cancel", id: "1" });
		b.deliver({ type: "cancelAll", prefix: "" });
		expect((workers[0] as FakeWorker).received.slice(1)).toEqual([
			{ type: "cancel", id: "1:1" },
			{ type: "cancelAll", prefix: "1:" },
		]);
	});

	it("cancels a port's work when it disconnects and drops late results", () => {
		const { workers, connect } = setup();
		const port = connect();
		port.deliver(synthesize("1"));
		port.drop();
		const worker = workers[0] as FakeWorker;
		expect(worker.received.at(-1)).toEqual({ type: "cancelAll", prefix: "0:" });
		expect(() => worker.reply(result("0:1"))).not.toThrow();
		expect(port.sent).toEqual([]);
	});

	it("broadcasts status to every port", () => {
		const { workers, connect } = setup();
		const a = connect();
		const b = connect();
		a.deliver(synthesize("1"));
		(workers[0] as FakeWorker).reply({ type: "status", state: "loading" });
		expect(a.sent).toEqual([{ type: "status", state: "loading" }]);
		expect(b.sent).toEqual([{ type: "status", state: "loading" }]);
	});

	it("ignores malformed messages and ports with another name", () => {
		const { workers, connect } = setup();
		const other = connect("something-else");
		other.deliver(synthesize("1"));
		const port = connect();
		port.deliver({ type: "synthesize", id: "1" });
		port.deliver("garbage");
		expect(workers).toHaveLength(0);
	});

	it("recovers from a worker crash: drops the ports, then starts a new worker", () => {
		const { workers, connect } = setup();
		const port = connect();
		port.deliver(synthesize("1"));
		const first = workers[0] as FakeWorker;
		first.onerror?.(new Error("crash"));
		expect(first.terminated).toBe(true);
		expect(port.disconnected).toBe(true);
		const next = connect();
		next.deliver(synthesize("1"));
		expect(workers).toHaveLength(2);
	});
});
