import type * as Ort from "onnxruntime-web";
import { alignWords } from "./align.ts";
import { loadPhonemizer, type Phonemes, phonemize } from "./phonemizer.ts";
import {
	HOP,
	SAMPLE_RATE,
	type SynthOptions,
	type WordTiming,
} from "./protocol.ts";
import { finished, normalize, splitLong } from "./text.ts";

/**
 * Most tokens in one model call. The model accepts 512, but cost grows faster than length and
 * slow speeds stretch the audio past the 32 s it was trained on. See docs/FINDINGS.md §4.
 */
export const MAX_TOKENS = 200;
/** The model can peak above full scale; each utterance is scaled down to this. */
const PEAK = 0.99;

export class NothingToPronounce extends Error {
	constructor() {
		super("Nothing to pronounce. tiny-voca only reads English.");
	}
}

export interface Utterance {
	pcm: Float32Array;
	sampleRate: number;
	words: WordTiming[];
}

export interface Engine {
	/** Resolves to null when `signal` aborts before the audio is complete. */
	speak(
		text: string,
		options: SynthOptions,
		signal?: AbortSignal,
	): Promise<Utterance | null>;
}

type OrtModule = Pick<typeof Ort, "InferenceSession" | "Tensor">;

export async function createEngine(
	ort: OrtModule,
	assets: { model: Uint8Array; gguf: ArrayBuffer },
): Promise<Engine> {
	const [session, phonemizer] = await Promise.all([
		ort.InferenceSession.create(assets.model, { executionProviders: ["wasm"] }),
		loadPhonemizer(assets.gguf),
	]);
	const int64 = (values: number[]) =>
		new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [
			1,
			values.length,
		]);
	const float = (value: number) =>
		new ort.Tensor("float32", Float32Array.of(value), [1]);

	async function synthesize(phonemes: Phonemes, options: SynthOptions) {
		const output = await session.run({
			tokens: int64(phonemes.ids),
			stress: int64(phonemes.stress),
			voice: new ort.Tensor(
				"int64",
				BigInt64Array.of(BigInt(options.voice)),
				[1],
			),
			speed: float(options.speed),
			pitch_shift: float(options.pitchShift),
			pitch_range: float(options.pitchRange),
		});
		const pcm = output.audio?.data;
		const durations = output.durations?.data;
		if (!(pcm instanceof Float32Array) || !(durations instanceof BigInt64Array))
			throw new Error("unexpected model output");
		let peak = 0;
		for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
		if (!Number.isFinite(peak))
			throw new Error("the model returned non-finite audio");
		if (peak > PEAK)
			for (let i = 0; i < pcm.length; i++)
				pcm[i] = ((pcm[i] ?? 0) * PEAK) / peak;
		return { pcm, durations };
	}

	return {
		async speak(text, options, signal) {
			// Phonemizing each candidate piece once: the result is reused for synthesis.
			const cache = new Map<string, Phonemes | null>();
			const phonemesOf = (piece: string) => {
				if (!cache.has(piece))
					cache.set(piece, phonemize(phonemizer, finished(piece)));
				return cache.get(piece) ?? null;
			};
			const pieces = splitLong(
				normalize(text),
				(piece) => (phonemesOf(piece)?.ids.length ?? 0) > MAX_TOKENS,
			);

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
				const seconds = (token: number) =>
					(samples + (starts[token] ?? 0) * HOP) / SAMPLE_RATE;
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
	};
}
