// Test doubles for runtime.Port and the engine Worker.
import type { EngineRequest, EngineResponse } from "./protocol.ts";
import type { PortLike, WorkerLike } from "./router.ts";

export class FakePort implements PortLike {
  name: string;
  sent: unknown[] = [];
  disconnected = false;
  /** When set, postMessage on this side delivers to the peer's message listeners. */
  peer: FakePort | null = null;
  private messageListeners: ((message: unknown) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];
  onMessage = {
    addListener: (listener: (message: unknown) => void) => void this.messageListeners.push(listener),
  };
  onDisconnect = {
    addListener: (listener: () => void) => void this.disconnectListeners.push(listener),
  };

  constructor(name = "engine") {
    this.name = name;
  }

  postMessage(message: unknown) {
    if (this.disconnected) throw new Error("Attempt to postMessage on disconnected port");
    this.sent.push(message);
    this.peer?.deliver(message);
  }

  /** Disconnecting one end fires onDisconnect on the other, as in the browser. */
  disconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    this.peer?.drop();
  }

  deliver(message: unknown) {
    for (const listener of this.messageListeners) listener(message);
  }

  /** The other end went away. */
  drop() {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.disconnectListeners) listener();
  }
}

/** Two connected ports: [the page's end, the background's end]. */
export function portPair(): [FakePort, FakePort] {
  const page = new FakePort();
  const background = new FakePort();
  page.peer = background;
  background.peer = page;
  return [page, background];
}

export class FakeWorker implements WorkerLike {
  received: EngineRequest[] = [];
  terminated = false;
  onmessage: ((event: { data: EngineResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: EngineRequest) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: EngineResponse) {
    this.onmessage?.({ data });
  }
}
