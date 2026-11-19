import {
  DEFAULT_SETTINGS,
  loadSettings,
  PREFETCH_LIMITS,
  SEMITONE,
  type Settings,
  saveSettings,
} from "@/content/settings.ts";
import { LIMITS, VOICES } from "@/engine/protocol.ts";

const form = document.getElementById("form") as HTMLFormElement;
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => form.elements.namedItem(name) as T;
const output = (name: string) => form.querySelector(`output[for="${name}"]`) as HTMLOutputElement;
const saved = document.getElementById("saved") as HTMLSpanElement;

const voice = field<HTMLSelectElement>("voice");
for (const [index, name] of VOICES.entries()) voice.add(new Option(name, String(index)));
const speed = field("speed");
const pitchShift = field("pitchShift"); // shown in semitones
const pitchRange = field("pitchRange");
const prefetch = field("prefetch");
[speed.min, speed.max] = LIMITS.speed.map(String) as [string, string];
[pitchRange.min, pitchRange.max] = LIMITS.pitchRange.map(String) as [string, string];
[prefetch.min, prefetch.max] = PREFETCH_LIMITS.map(String) as [string, string];
prefetch.setAttribute("aria-describedby", "prefetch-hint");

function show(settings: Settings) {
  voice.value = String(settings.voice);
  speed.value = String(settings.speed);
  pitchShift.value = String(Math.round((settings.pitchShift / SEMITONE) * 2) / 2);
  pitchRange.value = String(settings.pitchRange);
  prefetch.value = String(settings.prefetch);
  describe();
}

function describe() {
  const semitones = Number(pitchShift.value);
  output("speed").value = `${Number(speed.value).toFixed(2)}×`;
  output("pitchShift").value = `${semitones > 0 ? "+" : ""}${semitones} st`;
  output("pitchRange").value = `${Math.round(Number(pitchRange.value) * 100)}%`;
}

const read = (): Settings => ({
  voice: Number(voice.value),
  speed: Number(speed.value),
  pitchShift: Number(pitchShift.value) * SEMITONE,
  pitchRange: Number(pitchRange.value),
  // NaN for an emptied field, which saveSettings turns back into the default.
  prefetch: prefetch.valueAsNumber,
});

async function save(settings: Settings) {
  show(await saveSettings(settings));
  saved.textContent = "Saved. Used from the next reading.";
}

form.addEventListener("input", describe);
form.addEventListener("change", () => void save(read()));
form.addEventListener("submit", (event) => event.preventDefault());
document.getElementById("reset")?.addEventListener("click", () => void save(DEFAULT_SETTINGS));
loadSettings().then(show);
