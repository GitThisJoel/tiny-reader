import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineClient, EngineError } from "./client.ts";
import { FakePort, FakeWorker, portPair } from "./fakes.ts";
import { DEFAULT_OPTIONS } from "./protocol.ts";
import { createRouter } from "./router.ts";

function setup() {
  const ports: FakePort[] = [];
  const statuses: string[] = [];
  const client = new EngineClient(
    () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    (state) => statuses.push(state),
  );
  const reply = (id: string) =>
    ports.at(-1)?.deliver({
      type: "result",
      id,
      pcm: new Float32Array([0.5]),
      sampleRate: 24000,
      words: [],
    });
  return { client, ports, statuses, reply };
}
afterEach(() => vi.useRealTimers());

describe("EngineClient", () => {
  it("connects on the first request and resolves with the matching result", async () => {
    const { client, ports, reply } = setup();
    expect(ports).toHaveLength(0);
    const first = client.synthesize("One.", DEFAULT_OPTIONS);
    const second = client.synthesize("Two.", DEFAULT_OPTIONS);
    expect(ports).toHaveLength(1);
    expect(ports[0]?.sent).toEqual([
      { type: "synthesize", id: "0", text: "One.", options: DEFAULT_OPTIONS },
      { type: "synthesize", id: "1", text: "Two.", options: DEFAULT_OPTIONS },
    ]);
    reply("1");
    reply("0");
    expect((await first).pcm).toEqual(new Float32Array([0.5]));
    expect((await second).sampleRate).toBe(24000);
  });

  it("rejects with the engine's error", async () => {
    const { client, ports } = setup();
    const request = client.synthesize("…", DEFAULT_OPTIONS);
    ports[0]?.deliver({
      type: "error",
      id: "0",
      code: "nothing-to-pronounce",
      message: "no",
    });
    await expect(request).rejects.toMatchObject({
      code: "nothing-to-pronounce",
      message: "no",
    });
  });

  it("sends cancel on abort, rejects with the abort reason, ignores a late result", async () => {
    const { client, ports, reply } = setup();
    const controller = new AbortController();
    const request = client.synthesize("One.", DEFAULT_OPTIONS, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(ports[0]?.sent.at(-1)).toEqual({ type: "cancel", id: "0" });
    expect(() => reply("0")).not.toThrow();
  });

  it("sends nothing for a signal that is already aborted", async () => {
    const { client, ports } = setup();
    await expect(client.synthesize("One.", DEFAULT_OPTIONS, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(ports).toHaveLength(0);
  });

  it("does not cancel a request that already finished", async () => {
    const { client, ports, reply } = setup();
    const controller = new AbortController();
    const request = client.synthesize("One.", DEFAULT_OPTIONS, controller.signal);
    reply("0");
    await request;
    controller.abort();
    expect(ports[0]?.sent).toHaveLength(1);
  });

  it("fails pending requests when the background goes away, then reconnects", async () => {
    const { client, ports, reply } = setup();
    const lost = client.synthesize("One.", DEFAULT_OPTIONS);
    ports[0]?.drop();
    await expect(lost).rejects.toBeInstanceOf(EngineError);
    await expect(lost).rejects.toMatchObject({ code: "disconnected" });
    const again = client.synthesize("Two.", DEFAULT_OPTIONS);
    expect(ports).toHaveLength(2);
    reply("1");
    await expect(again).resolves.toBeDefined();
  });

  it("resends on a new port when the old one died silently, without failing that request", async () => {
    const { client, ports, reply } = setup();
    const earlier = client.synthesize("One.", DEFAULT_OPTIONS);
    // The background went away and onDisconnect has not fired yet: postMessage throws.
    (ports[0] as FakePort).disconnected = true;
    const fresh = client.synthesize("Two.", DEFAULT_OPTIONS);
    // What was sent on the dead port is lost; the new request is not.
    await expect(earlier).rejects.toMatchObject({ code: "disconnected" });
    expect(ports).toHaveLength(2);
    expect(ports[1]?.sent).toEqual([{ type: "synthesize", id: "1", text: "Two.", options: DEFAULT_OPTIONS }]);
    reply("1");
    await expect(fresh).resolves.toMatchObject({ sampleRate: 24000 });
  });

  it("rejects an invalid request through the router instead of hanging", async () => {
    const router = createRouter(() => new FakeWorker());
    const client = new EngineClient(() => {
      const [page, background] = portPair();
      router.connect(background);
      return page;
    });
    await expect(client.synthesize("Hi.", { ...DEFAULT_OPTIONS, speed: 9 })).rejects.toMatchObject({ code: "failed" });
  });

  it("reports status changes", () => {
    const { client, ports, statuses } = setup();
    client.synthesize("One.", DEFAULT_OPTIONS).catch(() => {});
    ports[0]?.deliver({ type: "status", state: "loading" });
    ports[0]?.deliver({ type: "status", state: "ready" });
    expect(statuses).toEqual(["loading", "ready"]);
  });

  it("pings every 20 s only while kept alive", () => {
    vi.useFakeTimers();
    const { client, ports } = setup();
    client.keepAlive(true);
    client.keepAlive(true);
    vi.advanceTimersByTime(45_000);
    expect(ports[0]?.sent).toEqual([{ type: "ping" }, { type: "ping" }]);
    client.keepAlive(false);
    vi.advanceTimersByTime(60_000);
    expect(ports[0]?.sent).toHaveLength(2);
  });

  it("close rejects pending work and disconnects", async () => {
    const { client, ports } = setup();
    const request = client.synthesize("One.", DEFAULT_OPTIONS);
    client.close();
    await expect(request).rejects.toMatchObject({ code: "disconnected" });
    expect(ports[0]?.disconnected).toBe(true);
  });

  it("works end to end through the router: result, cancel, and cancel-on-close", async () => {
    const worker = new FakeWorker();
    const router = createRouter(() => worker);
    const client = new EngineClient(() => {
      const [page, background] = portPair();
      router.connect(background);
      return page;
    });
    const first = client.synthesize("One.", DEFAULT_OPTIONS);
    expect(worker.received).toEqual([{ type: "synthesize", id: "0:0", text: "One.", options: DEFAULT_OPTIONS }]);
    worker.reply({
      type: "result",
      id: "0:0",
      pcm: new Float32Array(2),
      sampleRate: 24000,
      words: [],
    });
    expect((await first).pcm).toHaveLength(2);

    const controller = new AbortController();
    const second = client.synthesize("Two.", DEFAULT_OPTIONS, controller.signal);
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.received.at(-1)).toEqual({ type: "cancel", id: "0:1" });

    client.synthesize("Three.", DEFAULT_OPTIONS).catch(() => {});
    client.close();
    expect(worker.received.at(-1)).toEqual({ type: "cancelAll", prefix: "0:" });
  });
});
