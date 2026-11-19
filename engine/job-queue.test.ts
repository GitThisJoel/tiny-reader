import { describe, expect, it } from "vitest";
import { JobQueue } from "./job-queue.ts";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

describe("JobQueue", () => {
	it("runs jobs one at a time, in order", async () => {
		const queue = new JobQueue();
		const log: string[] = [];
		const gate = deferred<void>();
		const a = queue.run("a", async () => {
			log.push("a start");
			await gate.promise;
			log.push("a end");
			return 1;
		});
		const b = queue.run("b", async () => {
			log.push("b start");
			return 2;
		});
		await Promise.resolve();
		expect(log).toEqual(["a start"]);
		gate.resolve();
		expect(await Promise.all([a, b])).toEqual([1, 2]);
		expect(log).toEqual(["a start", "a end", "b start"]);
		expect(queue.size).toBe(0);
	});

	it("never starts a job cancelled while waiting", async () => {
		const queue = new JobQueue();
		const gate = deferred<void>();
		let ran = false;
		const a = queue.run("a", () => gate.promise.then(() => "a"));
		const b = queue.run("b", async () => {
			ran = true;
			return "b";
		});
		queue.cancel("b");
		gate.resolve();
		expect(await a).toBe("a");
		expect(await b).toBeUndefined();
		expect(ran).toBe(false);
	});

	it("aborts the running job and discards its result", async () => {
		const queue = new JobQueue();
		const gate = deferred<void>();
		let seen: AbortSignal | undefined;
		const a = queue.run("a", async (signal) => {
			seen = signal;
			await gate.promise;
			return "late";
		});
		await Promise.resolve();
		queue.cancel("a");
		expect(seen?.aborted).toBe(true);
		gate.resolve();
		expect(await a).toBeUndefined();
	});

	it("cancels by prefix and leaves the rest", async () => {
		const queue = new JobQueue();
		const gate = deferred<void>();
		const first = queue.run("0:1", () => gate.promise.then(() => "x"));
		const mine = queue.run("1:1", async () => "mine");
		const theirs = queue.run("2:1", async () => "theirs");
		queue.cancelAll("1:");
		gate.resolve();
		expect(await Promise.all([first, mine, theirs])).toEqual([
			"x",
			undefined,
			"theirs",
		]);
	});

	it("keeps going after a job fails", async () => {
		const queue = new JobQueue();
		const bad = queue.run("bad", async () => {
			throw new Error("boom");
		});
		const good = queue.run("good", async () => "ok");
		await expect(bad).rejects.toThrow("boom");
		expect(await good).toBe("ok");
	});

	it("replaces a job that reuses an id", async () => {
		const queue = new JobQueue();
		const gate = deferred<void>();
		const old = queue.run("a", () => gate.promise.then(() => "old"));
		const fresh = queue.run("a", async () => "new");
		gate.resolve();
		expect(await old).toBeUndefined();
		expect(await fresh).toBe("new");
	});
});
