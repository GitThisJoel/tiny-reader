import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, parseRequest } from "./protocol.ts";

describe("parseRequest", () => {
	const synthesize = {
		type: "synthesize",
		id: "1",
		text: "Hello.",
		options: DEFAULT_OPTIONS,
	};

	it("accepts each valid request", () => {
		expect(parseRequest(synthesize)).toEqual(synthesize);
		expect(parseRequest({ type: "cancel", id: "1" })).toEqual({
			type: "cancel",
			id: "1",
		});
		expect(parseRequest({ type: "cancelAll", prefix: "" })).toEqual({
			type: "cancelAll",
			prefix: "",
		});
		expect(parseRequest({ type: "ping" })).toEqual({ type: "ping" });
	});

	it("drops unknown fields", () => {
		expect(
			parseRequest({
				...synthesize,
				extra: 1,
				options: { ...DEFAULT_OPTIONS, evil: true },
			}),
		).toEqual(synthesize);
	});

	it.each([
		null,
		undefined,
		"synthesize",
		42,
		{},
		{ type: "nope" },
		{ type: "cancel" },
		{ type: "cancel", id: 1 },
		{ type: "cancelAll" },
		{ ...synthesize, id: 1 },
		{ ...synthesize, text: undefined },
		{ ...synthesize, text: "x".repeat(20_001) },
		{ ...synthesize, options: undefined },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, voice: 2 } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, voice: 0.5 } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, voice: -1 } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, speed: 0 } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, speed: 9 } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, speed: Number.NaN } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, pitchShift: "0" } },
		{ ...synthesize, options: { ...DEFAULT_OPTIONS, pitchRange: -1 } },
	])("rejects %j", (message) => {
		expect(parseRequest(message)).toBeNull();
	});
});
