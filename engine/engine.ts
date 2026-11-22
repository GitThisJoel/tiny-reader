import type * as Ort from "onnxruntime-web";
import { alignWords } from "./align.ts";
import type { FrontEnd } from "./frontends.ts";
import { checkIo } from "./models.ts";
import type { Phonemes } from "./phonemizer.ts";
import { HOP, SAMPLE_RATE, type SynthOptions, type Utterance, type WordTiming } from "./protocol.ts";
import { finished, normalize, splitLong } from "./text.ts";

/**
 * Most tokens in one model call. The model accepts 512, but cost grows faster than length and
 * slow speeds stretch the audio past the 32 s it was trained on. See docs/FINDINGS.md §3.
 */
export const MAX_TOKENS = 200;
/** The model can peak above full scale; each utterance is scaled down to this. */
const PEAK = 0.99;

export class NothingToPronounce extends Error {
  /** `why`: which language the model reads, for the user. */
  constructor(why = "") {
    super(`Nothing to pronounce.${why && ` ${why}.`}`);
  }
}

export type { Utterance };

export interface Engine {
  /** Resolves to null when `signal` aborts before the audio is complete. */
  speak(text: string, options: Omit<SynthOptions, "model">, signal?: AbortSignal): Promise<Utterance | null>;
  /** Frees the model's memory. The engine cannot be used afterwards. */
  release(): Promise<void>;
}

type OrtModule = Pick<typeof Ort, "InferenceSession" | "Tensor">;

/**
 * `frontEnd` is the text front end the model was trained with (engine/frontends.ts). `inputs` are
 * the inputs the model has besides the usual six, with the value to give each.
 * Rejects with a ModelError when the file's inputs and outputs are not what that makes a model's.
 */
export async function createEngine(
  ort: OrtModule,
  assets: { model: Uint8Array; frontEnd: FrontEnd; inputs?: Readonly<Record<string, number>> },
): Promise<Engine> {
  const session = await ort.InferenceSession.create(assets.model, { executionProviders: ["wasm"] });
  const more = Object.entries(assets.inputs ?? {});
  try {
    checkIo(
      session,
      more.map(([name]) => name),
    );
  } catch (error) {
    await session.release();
    throw error;
  }
  const int64 = (values: number[]) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, values.length]);
  const float = (value: number) => new ort.Tensor("float32", Float32Array.of(value), [1]);

  async function synthesize(phonemes: Phonemes, options: Omit<SynthOptions, "model">) {
    const output = await session.run({
      tokens: int64(phonemes.ids),
      stress: int64(phonemes.stress),
      voice: new ort.Tensor("int64", BigInt64Array.of(BigInt(options.voice)), [1]),
      speed: float(options.speed),
      pitch_shift: float(options.pitchShift),
      pitch_range: float(options.pitchRange),
      ...Object.fromEntries(more.map(([name, value]) => [name, float(value)])),
    });
    const pcm = output.audio?.data;
    const durations = output.durations?.data;
    if (!(pcm instanceof Float32Array) || !(durations instanceof BigInt64Array))
      throw new Error("unexpected model output");
    let peak = 0;
    for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
    if (!Number.isFinite(peak)) throw new Error("the model returned non-finite audio");
    if (peak > PEAK) for (let i = 0; i < pcm.length; i++) pcm[i] = ((pcm[i] ?? 0) * PEAK) / peak;
    return { pcm, durations };
  }

  return {
    async speak(text, options, signal) {
      // Phonemizing each candidate piece once: the result is reused for synthesis.
      const cache = new Map<string, Phonemes | null>();
      const phonemesOf = (piece: string) => cache.get(piece) ?? null;
      // A front end may take its time (the German one runs a model of its own), and the cutting
      // is synchronous. So a piece not phonemized yet is taken as short enough, phonemized after
      // the pass, and the cutting is done again until it meets nothing new.
      let pieces: ReturnType<typeof splitLong>;
      for (;;) {
        const unknown: string[] = [];
        pieces = splitLong(normalize(text), (piece) => {
          if (!cache.has(piece)) unknown.push(piece);
          return (phonemesOf(piece)?.ids.length ?? 0) > MAX_TOKENS;
        });
        if (!unknown.length) break;
        for (const piece of unknown) {
          if (signal?.aborted) return null;
          cache.set(piece, await assets.frontEnd(finished(piece)));
        }
      }

      const chunks: Float32Array[] = [];
      const words: WordTiming[] = [];
      let samples = 0;
      for (const piece of pieces) {
        const phonemes = phonemesOf(piece.text);
        if (!phonemes) continue;
        if (signal?.aborted) return null;
        const { pcm, durations } = await synthesize(phonemes, options);
        // Token start times: cumulative frames, HOP samples each.
        const starts = new Float64Array(durations.length + 1);
        durations.forEach((frames, i) => {
          starts[i + 1] = (starts[i] ?? 0) + Number(frames);
        });
        const seconds = (token: number) => (samples + (starts[token] ?? 0) * HOP) / SAMPLE_RATE;
        const spoken = phonemes.words.map((word) => ({
          text: word.text,
          start: seconds(word.tokenStart),
          end: seconds(word.tokenEnd),
        }));
        // Positions are in the text the page sent: pieces keep their offsets.
        for (const timing of alignWords(piece.text, spoken))
          words.push({
            ...timing,
            charStart: timing.charStart + piece.offset,
            charEnd: timing.charEnd + piece.offset,
          });
        chunks.push(pcm);
        samples += pcm.length;
      }
      if (signal?.aborted) return null;
      if (!chunks.length) throw new NothingToPronounce();

      const [first] = chunks;
      let pcm = first as Float32Array;
      if (chunks.length > 1) {
        pcm = new Float32Array(samples);
        let at = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, at);
          at += chunk.length;
        }
      }
      return { pcm, sampleRate: SAMPLE_RATE, words };
    },
    release: () => session.release(),
  };
}
