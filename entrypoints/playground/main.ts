import { browser } from "wxt/browser";
import { EngineClient } from "@/engine/client.ts";
import { DEFAULT_OPTIONS, PORT_NAME, VOICES } from "@/engine/protocol.ts";

const byId = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const text = byId<HTMLTextAreaElement>("text");
const voice = byId<HTMLSelectElement>("voice");
const speed = byId<HTMLInputElement>("speed");
const status = byId<HTMLParagraphElement>("status");
const say = (message: string) => {
	status.textContent = message;
};

for (const [index, name] of VOICES.entries())
	voice.add(new Option(name, String(index)));

const client = new EngineClient(
	() => browser.runtime.connect({ name: PORT_NAME }),
	(state) => state === "loading" && say("Loading the model…"),
);
let audio: AudioContext | null = null;
let current: AbortController | null = null;
let source: AudioBufferSourceNode | null = null;

function stop() {
	current?.abort();
	current = null;
	source?.stop();
	source = null;
}

byId("stop").addEventListener("click", () => {
	stop();
	say("Stopped.");
});

byId<HTMLFormElement>("form").addEventListener("submit", async (event) => {
	event.preventDefault();
	stop();
	const controller = new AbortController();
	current = controller;
	audio ??= new AudioContext();
	await audio.resume();
	say("Synthesizing…");
	const started = performance.now();
	try {
		const result = await client.synthesize(
			text.value,
			{
				...DEFAULT_OPTIONS,
				voice: Number(voice.value),
				speed: Number(speed.value),
			},
			controller.signal,
		);
		const buffer = audio.createBuffer(1, result.pcm.length, result.sampleRate);
		buffer.getChannelData(0).set(result.pcm);
		source = new AudioBufferSourceNode(audio, { buffer });
		source.connect(audio.destination);
		source.start();
		const seconds = (result.pcm.length / result.sampleRate).toFixed(2);
		say(
			`Playing ${seconds} s of audio, made in ${Math.round(performance.now() - started)} ms. ${result.words.length} words.`,
		);
	} catch (error) {
		if (controller.signal.aborted) return;
		say(`Error: ${error instanceof Error ? error.message : String(error)}`);
	}
});
