#!/usr/bin/env python3
"""Experiment: an int8 (dynamically quantized) copy of the model next to the float32 one.

    python3 scripts/quantize-experiment.py [--output .output/int8-experiment]

Needs onnxruntime, onnx and numpy. It reads public/assets/model.onnx (run `pnpm fetch-assets`
first) and the phoneme ids recorded in tests/parity/fixtures.json, so no phonemizer is needed.

It writes two quantized models (see VARIANTS), WAV files to compare by ear
(NN-voice-float32.wav, NN-voice-int8.wav, NN-voice-int8-matmul.wav), and prints sizes, speed,
how often the predicted durations stay identical, and a log-spectral distance. The model draws fresh noise on every run, so two float32 runs of the same sentence
also differ: that distance is printed as the floor to compare against.

The results are written up in docs/FINDINGS.md. Nothing here is used by the add-on.
"""

import argparse
import json
import struct
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic

ROOT = Path(__file__).resolve().parent.parent
RATE, HOP = 24000, 256
SENTENCES = 20  # tiny-voca's own test sentences: the first lines of tests/parity/extra.txt


def cases():
    wanted = [line for line in (ROOT / "tests/parity/extra.txt").read_text(encoding="utf-8").splitlines()
              if line.strip() and not line.startswith("#")][:SENTENCES]
    fixtures = {case["text"]: case for case in json.loads((ROOT / "tests/parity/fixtures.json").read_text(encoding="utf-8"))["cases"]}
    # Two of the twenty hold nothing to pronounce and have no ids.
    return [fixtures[text] for text in wanted if fixtures[text]["ids"]]


def session(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1  # like the add-on: single-threaded
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def run(model, case, voice):
    one = lambda value: np.array([value], dtype=np.float32)
    started = time.perf_counter()
    audio, durations = model.run(None, {
        "tokens": np.array([case["ids"]], dtype=np.int64), "stress": np.array([case["stress"]], dtype=np.int64),
        "voice": np.array([voice], dtype=np.int64), "speed": one(1.0), "pitch_shift": one(0.0), "pitch_range": one(1.0)})
    return audio[0], durations[0], time.perf_counter() - started


def log_spectrum(audio, size=1024, hop=256):
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(audio, size // 2), size)[::hop]
    return 20 * np.log10(np.abs(np.fft.rfft(frames * np.hanning(size), axis=1)) + 1e-5)


def distance(a, b):
    """Log-spectral distance in dB between two clips of the same length."""
    x, y = log_spectrum(a), log_spectrum(b)
    return float(np.mean(np.sqrt(np.mean((x - y) ** 2, axis=1))))


def write_wav(path, audio):
    audio = audio * min(1.0, 0.99 / max(1e-9, float(np.abs(audio).max())))
    pcm = (audio * 32767).astype("<i2").tobytes()
    path.write_bytes(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, RATE, 2 * RATE, 2, 16)
                     + b"data" + struct.pack("<I", len(pcm)) + pcm)


# Two ways to quantize: everything onnxruntime quantizes by default (MatMul and Conv, which
# includes the fixed Fourier-transform kernels of the waveform generator), or the transformer
# weights only.
VARIANTS = {"int8": None, "int8-matmul": ["MatMul"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--output", type=Path, default=ROOT / ".output/int8-experiment")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = ROOT / "public/assets/model.onnx"
    size = lambda path: path.stat().st_size / 1e6
    float32 = session(source)
    runs = [(case, voice) for case in cases() for voice in (0, 1)]
    run(float32, runs[0][0], 0)  # warm up

    # float32 twice: the reference, and the floor that fresh noise alone puts under any comparison.
    reference, floor, float_seconds = [], [], 0.0
    for index, (case, voice) in enumerate(runs):
        audio, durations, took = run(float32, case, voice)
        again, _, _ = run(float32, case, voice)
        reference.append((audio, durations))
        floor.append(distance(audio, again))
        float_seconds += took
        if index < 8:
            write_wav(args.output / f"{index // 2 + 1:02d}-{'FM'[voice]}2-float32.wav", audio)
    audio_seconds = sum(len(audio) for audio, _ in reference) / RATE
    print(f"float32      {size(source):6.2f} MB        {audio_seconds / float_seconds:5.1f}x real time   "
          f"spectral floor (float32 against itself) {np.mean(floor):.2f} dB")

    for name, operators in VARIANTS.items():
        target = args.output / f"model.{name}.onnx"
        quantize_dynamic(str(source), str(target), weight_type=QuantType.QInt8, op_types_to_quantize=operators)
        model = session(target)
        run(model, runs[0][0], 0)
        seconds, same, change, spectral = 0.0, 0, [], []
        for index, (case, voice) in enumerate(runs):
            audio, durations, took = run(model, case, voice)
            wanted_audio, wanted = reference[index]
            seconds += took
            change.append(abs(int(durations.sum()) - int(wanted.sum())) / int(wanted.sum()))
            if np.array_equal(durations, wanted):
                same += 1
                spectral.append(distance(wanted_audio, audio))
            if index < 8:
                write_wav(args.output / f"{index // 2 + 1:02d}-{'FM'[voice]}2-{name}.wav", audio)
        print(f"{name:12} {size(target):6.2f} MB ({size(target) / size(source):4.0%})  {audio_seconds / seconds:5.1f}x real time   "
              f"durations identical in {same}/{len(runs)}, length off by {np.mean(change):.2%} mean {np.max(change):.2%} max, "
              f"spectral distance {np.mean(spectral) if spectral else float('nan'):.2f} dB over those {same}")
    print(f"onnxruntime {ort.__version__}, CPU, 1 thread, {len(runs)} utterances, {audio_seconds:.0f} s of audio. WAVs to compare: {args.output}")


if __name__ == "__main__":
    main()
