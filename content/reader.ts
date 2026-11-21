import { BUNDLED, modelById, readsOnly } from "@/engine/models.ts";
import type { SynthOptions, Utterance } from "@/engine/protocol.ts";

export type { Utterance };

/** Where audio goes. Items play back to back, in the order they were enqueued. */
export interface AudioSink {
  /**
   * `onStart` is called when the item starts sounding, `onEnd` when it has finished.
   * When one item follows another, the next `onStart` comes before the previous `onEnd`.
   */
  enqueue(utterance: Utterance, onStart: () => void, onEnd: () => void): void;
  /** Silences and forgets everything enqueued. No callbacks are called for it. */
  clear(): void;
  pause(): void;
  /** Resolves to false when the browser will not start audio without a user gesture. */
  resume(): Promise<boolean>;
}

export type ReaderStatus =
  | "loading" // waiting for the engine: first sentence, or the queue ran dry
  | "playing"
  | "paused"
  | "blocked" // audio needs a click on the page first
  | "done"
  | "error";

export interface ReaderState {
  status: ReaderStatus;
  /** Sentence being spoken or waited for. */
  index: number;
  total: number;
  /** The utterance being spoken, while status is "playing". */
  utterance?: Utterance;
  message?: string;
}

export interface ReaderDeps {
  synthesize(text: string, options: SynthOptions, signal: AbortSignal): Promise<Utterance>;
  sink: AudioSink;
  onState(state: ReaderState): void;
  /** How many sentences beyond the current one to synthesize ahead. */
  prefetch?: number;
}

const codeOf = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

/**
 * Reads a list of sentences: synthesizes ahead, plays in order without gaps, and supports
 * pause, skip, option changes and stop. Every piece of in-flight work it no longer needs is
 * aborted through its AbortSignal.
 */
export class Reader {
  private sentences: string[] = [];
  private options: SynthOptions;
  private readonly deps: ReaderDeps;
  private readonly prefetch: number;

  /** Sentence being spoken or waited for. */
  private current = 0;
  /** Next sentence to hand to the sink. */
  private enqueued = 0;
  /** Sentence audibly playing, or -1. */
  private sounding = -1;
  private requests = new Map<number, AbortController>();
  private ready = new Map<number, Utterance | "skip">();
  private attempts = new Map<number, number>();
  /** Sentences the engine found nothing to pronounce in. */
  private skipped = new Set<number>();
  private paused = false;
  private blocked = false;
  private stopped = true;
  private error: string | null = null;

  constructor(deps: ReaderDeps, options: SynthOptions) {
    this.deps = deps;
    this.options = options;
    this.prefetch = deps.prefetch ?? 2;
  }

  /** Starts reading `sentences` from `from`, replacing whatever was being read. */
  read(sentences: string[], from = 0) {
    this.reset();
    this.sentences = sentences;
    this.current = this.enqueued = Math.max(0, Math.min(from, sentences.length));
    this.stopped = false;
    this.paused = false;
    this.error = null;
    this.skipped.clear();
    // Synthesis starts at once, also when the browser makes us wait for a click to play.
    this.pump();
    this.deps.sink.resume().then((running) => {
      if (this.stopped || this.paused) return;
      this.blocked = !running;
      this.emit();
    });
  }

  pause() {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.deps.sink.pause();
    this.emit();
  }

  async play() {
    if (this.stopped) return;
    this.paused = false;
    const running = await this.deps.sink.resume();
    if (this.stopped || this.paused) return;
    this.blocked = !running;
    this.pump();
  }

  toggle() {
    return this.paused || this.blocked ? this.play() : this.pause();
  }

  next() {
    this.jump(this.current + 1);
  }

  previous() {
    this.jump(this.current - 1);
  }

  /** New voice or speed: the current sentence starts again with them. */
  setOptions(options: SynthOptions) {
    this.options = options;
    if (this.stopped) return;
    this.dropWork(() => true);
    this.jump(this.current);
  }

  stop() {
    if (this.stopped) return;
    this.reset();
    this.stopped = true;
  }

  get state(): ReaderState {
    const base = {
      index: Math.min(this.current, this.sentences.length),
      total: this.sentences.length,
    };
    if (this.error) return { ...base, status: "error", message: this.error };
    if (this.current >= this.sentences.length) return { ...base, status: "done" };
    if (this.paused) return { ...base, status: "paused" };
    if (this.blocked) return { ...base, status: "blocked" };
    const utterance = this.ready.get(this.current);
    if (this.sounding === this.current && utterance && utterance !== "skip")
      return { ...base, status: "playing", utterance };
    return { ...base, status: "loading" };
  }

  private jump(target: number) {
    if (this.stopped || this.error) return;
    const to = Math.max(0, Math.min(target, this.sentences.length));
    this.deps.sink.clear();
    this.sounding = -1;
    // Keep what is still useful: finished or in-flight work inside the new window.
    this.dropWork((index) => index < to || index > to + this.prefetch);
    this.current = this.enqueued = to;
    this.pump();
  }

  private dropWork(unwanted: (index: number) => boolean) {
    for (const [index, controller] of [...this.requests]) {
      if (!unwanted(index)) continue;
      this.requests.delete(index);
      controller.abort();
    }
    for (const index of [...this.ready.keys()]) if (unwanted(index)) this.ready.delete(index);
  }

  private reset() {
    this.dropWork(() => true);
    this.deps.sink.clear();
    this.attempts.clear();
    this.sounding = -1;
    this.blocked = false;
  }

  /** Requests what is missing, hands finished audio to the sink, and reports the state. */
  private pump() {
    if (this.stopped || this.error) return;
    try {
      this.advance();
    } catch (error) {
      // A playback failure must reach the user, not vanish in a promise.
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private advance() {
    const total = this.sentences.length;
    while (this.sounding < 0 && this.ready.get(this.current) === "skip") {
      this.ready.delete(this.current);
      this.current += 1;
      this.enqueued = Math.max(this.enqueued, this.current);
    }
    for (let index = this.current; index <= this.current + this.prefetch && index < total; index++)
      if (!this.ready.has(index) && !this.requests.has(index)) this.request(index);
    // The sink holds the sentence playing and at most the one after it, so a skip or a
    // stop never has much scheduled audio to throw away.
    while (this.enqueued < total && this.enqueued <= this.current + 1) {
      const index = this.enqueued;
      const item = this.ready.get(index);
      if (!item) break;
      this.enqueued += 1;
      if (item === "skip") continue;
      this.deps.sink.enqueue(
        item,
        () => this.started(index),
        () => this.ended(index),
      );
    }
    if (this.current >= total && this.skipped.size === total && total > 0)
      this.error = `Nothing here could be read. ${readsOnly(modelById(this.options.model) ?? BUNDLED)}.`;
    this.emit();
  }

  private started(index: number) {
    this.current = index;
    this.sounding = index;
    this.emit();
  }

  private ended(index: number) {
    this.ready.delete(index);
    if (this.sounding === index) {
      this.sounding = -1;
      this.current = index + 1;
    }
    this.pump();
  }

  private request(index: number) {
    const controller = new AbortController();
    this.requests.set(index, controller);
    const mine = () => this.requests.get(index) === controller;
    this.deps.synthesize(this.sentences[index] ?? "", this.options, controller.signal).then(
      (utterance) => {
        if (!mine()) return;
        this.requests.delete(index);
        this.ready.set(index, utterance);
        this.pump();
      },
      (error: unknown) => {
        if (!mine()) return;
        this.requests.delete(index);
        const code = codeOf(error);
        if (code === "nothing-to-pronounce") {
          // Another script, or signs only.
          this.skipped.add(index);
          this.ready.set(index, "skip");
        } else {
          // The engine is unloaded when idle (for example during a long pause):
          // a lost connection is retried once before it counts as a failure.
          const tries = (this.attempts.get(index) ?? 0) + 1;
          this.attempts.set(index, tries);
          if (code !== "disconnected" || tries > 1) {
            this.fail(error instanceof Error ? error.message : String(error));
            return;
          }
        }
        this.pump();
      },
    );
  }

  private fail(message: string) {
    this.reset();
    this.error = message;
    this.emit();
  }

  private emit() {
    this.deps.onState(this.state);
  }
}
