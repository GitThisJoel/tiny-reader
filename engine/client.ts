import type { EngineErrorCode, EngineRequest, EngineResponse, SynthOptions, Utterance } from "./protocol.ts";
import type { PortLike } from "./router.ts";

export type { Utterance };

export class EngineError extends Error {
  readonly code: EngineErrorCode | "disconnected";

  constructor(code: EngineErrorCode | "disconnected", message: string) {
    super(message);
    this.code = code;
  }
}

/** While reading, a ping this often keeps the background event page from being suspended (30 s). */
const PING_MS = 20_000;

/**
 * The page's side of the engine protocol: one port, request ids, cancellation.
 * The port is opened by the first request and reopened after the background goes away.
 */
export class EngineClient {
  private port: PortLike | null = null;
  private pending = new Map<string, { resolve(value: Utterance): void; reject(error: Error): void }>();
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly connect: () => PortLike;
  private readonly onStatus: (state: "loading" | "ready") => void;
  private readonly onNotice: (notice: string) => void;

  /** `onNotice` is told when the engine had to speak with another model than the one asked for. */
  constructor(
    connect: () => PortLike,
    onStatus: (state: "loading" | "ready") => void = () => {},
    onNotice: (notice: string) => void = () => {},
  ) {
    this.connect = connect;
    this.onStatus = onStatus;
    this.onNotice = onNotice;
  }

  /**
   * Rejects with an AbortError when `signal` aborts (the engine is told to drop the work),
   * or with an EngineError.
   */
  synthesize(text: string, options: SynthOptions, signal?: AbortSignal): Promise<Utterance> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = String(this.nextId++);
    return new Promise<Utterance>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        this.send({ type: "cancel", id });
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => signal?.removeEventListener("abort", onAbort);
      this.pending.set(id, {
        resolve: (value) => {
          done();
          resolve(value);
        },
        reject: (error) => {
          done();
          reject(error);
        },
      });
      this.send({ type: "synthesize", id, text, options });
    });
  }

  /** Keep the engine loaded (true while reading) or let Firefox unload it when idle (false). */
  keepAlive(on: boolean) {
    if (on && !this.timer) this.timer = setInterval(() => this.send({ type: "ping" }), PING_MS);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drops all work and the connection. The client can be used again afterwards. */
  close() {
    this.keepAlive(false);
    const port = this.port;
    this.port = null;
    port?.disconnect();
    this.failAll("disconnected", "closed");
  }

  private send(message: EngineRequest) {
    try {
      this.open().postMessage(message);
    } catch {
      // The port died without telling us yet. Everything sent on it is lost, but not this
      // message: it never left, so its request stays pending and goes out on a new port.
      const id = message.type === "synthesize" ? message.id : null;
      const mine = id === null ? undefined : this.pending.get(id);
      if (id !== null) this.pending.delete(id);
      this.lost(this.port);
      if (id !== null && mine) this.pending.set(id, mine);
      this.open().postMessage(message);
    }
  }

  private open(): PortLike {
    if (this.port) return this.port;
    const port = this.connect();
    port.onMessage.addListener((message) => this.receive(message as EngineResponse));
    port.onDisconnect.addListener(() => this.lost(port));
    this.port = port;
    return port;
  }

  private lost(port: PortLike | null) {
    if (this.port !== port) return;
    this.port = null;
    this.failAll("disconnected", "The speech engine stopped.");
  }

  private failAll(code: "disconnected", message: string) {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const request of waiting) request.reject(new EngineError(code, message));
  }

  private receive(message: EngineResponse) {
    if (message.type === "status") return this.onStatus(message.state);
    const request = this.pending.get(message.id);
    if (!request) return; // cancelled, or from before a reconnect
    this.pending.delete(message.id);
    if (message.type === "error") request.reject(new EngineError(message.code, message.message));
    else {
      if (message.notice) this.onNotice(message.notice);
      request.resolve({
        pcm: message.pcm,
        sampleRate: message.sampleRate,
        words: message.words,
      });
    }
  }
}
