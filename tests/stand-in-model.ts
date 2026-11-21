// A stand-in for a tiny-voca model: the same inputs and outputs in a few hundred bytes of ONNX,
// written out by hand. Every token "sounds" for 8 frames at a constant level, so the engine and
// the reader can run with it as they do with a real model. Nobody would want to listen to it.

const FLOAT = 1;
const INT64 = 7;

// Protocol Buffers wire format: all an ONNX file is.
function varint(value: number): number[] {
  const out: number[] = [];
  for (; value > 127; value = Math.floor(value / 128)) out.push((value % 128) | 128);
  return [...out, value];
}
const int = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
const bytes = (field: number, payload: ArrayLike<number>) => [
  ...varint(field * 8 + 2),
  ...varint(payload.length),
  ...Array.from(payload),
];
const text = (field: number, value: string) => bytes(field, new TextEncoder().encode(value));

/** ValueInfoProto: a graph input or output. A string in `shape` is a dimension of any length. */
const value = (name: string, type: number, shape: (number | string)[]) => [
  ...text(1, name),
  ...bytes(
    2,
    bytes(1, [
      ...int(1, type),
      ...bytes(
        2,
        shape.flatMap((size) => bytes(1, typeof size === "number" ? int(1, size) : text(2, size))),
      ),
    ]),
  ),
];
/** TensorProto: a constant. */
const constant = (name: string, type: number, shape: number[], data: Float32Array | BigInt64Array) => [
  ...shape.flatMap((size) => int(1, size)),
  ...int(2, type),
  ...text(8, name),
  ...bytes(9, new Uint8Array(data.buffer)),
];
/** NodeProto. `to` is Cast's target type. */
const node = (op: string, inputs: string[], output: string, to?: number) => [
  ...inputs.flatMap((name) => text(1, name)),
  ...text(2, output),
  ...text(4, op),
  ...(to ? bytes(5, [...text(1, "to"), ...int(3, to), ...int(20, 2)]) : []),
];

/**
 * The model file. `voiceInput` renames the `voice` input, which makes a model the engine must
 * refuse.
 */
export function standInModel(voiceInput = "voice"): Uint8Array<ArrayBuffer> {
  const graph = [
    // Every input is used, so that none is optimized away: their sum, times zero.
    node("Cast", ["tokens"], "t", FLOAT),
    node("Cast", ["stress"], "s", FLOAT),
    node("Cast", [voiceInput], "v", FLOAT),
    node("Add", ["t", "s"], "a1"),
    node("Add", ["a1", "v"], "a2"),
    node("Add", ["a2", "speed"], "a3"),
    node("Add", ["a3", "pitch_shift"], "a4"),
    node("Add", ["a4", "pitch_range"], "a5"),
    node("Mul", ["a5", "zero"], "silence"),
    // audio: [1, tokens] at a constant level, repeated to 8 frames of 256 samples per token.
    node("Add", ["silence", "level"], "tone"),
    node("Tile", ["tone", "repeats"], "audio"),
    // durations: 8 frames for every token.
    node("Cast", ["silence"], "none", INT64),
    node("Add", ["none", "frames"], "durations"),
  ].flatMap((each) => bytes(1, each));
  const constants = [
    constant("zero", FLOAT, [], Float32Array.of(0)),
    constant("level", FLOAT, [], Float32Array.of(0.1)),
    constant("repeats", INT64, [2], BigInt64Array.of(1n, 2048n)),
    constant("frames", INT64, [], BigInt64Array.of(8n)),
  ].flatMap((each) => bytes(5, each));
  const inputs = [
    value("tokens", INT64, [1, "tokens"]),
    value("stress", INT64, [1, "tokens"]),
    value(voiceInput, INT64, [1]),
    value("speed", FLOAT, [1]),
    value("pitch_shift", FLOAT, [1]),
    value("pitch_range", FLOAT, [1]),
  ].flatMap((each) => bytes(11, each));
  const outputs = [value("audio", FLOAT, [1, "samples"]), value("durations", INT64, [1, "tokens"])].flatMap((each) =>
    bytes(12, each),
  );
  // ModelProto: IR version 8, the default operator set at version 17, and the graph.
  return Uint8Array.from([
    ...int(1, 8),
    ...bytes(8, int(2, 17)),
    ...bytes(7, [...graph, ...text(2, "stand-in"), ...constants, ...inputs, ...outputs]),
  ]);
}
