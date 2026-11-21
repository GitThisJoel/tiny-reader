// The settings form, used by the options page and by the toolbar popup.
import { LIMITS, VOICES } from "@/engine/protocol.ts";
import "./settings-form.css";
import { DEFAULT_SETTINGS, loadSettings, PREFETCH_LIMITS, SEMITONE, type Settings, saveSettings } from "./settings.ts";

function create<K extends keyof HTMLElementTagNameMap>(tag: K, properties: Record<string, string> = {}) {
  const element = document.createElement(tag);
  Object.assign(element, properties);
  return element;
}

/** Label, slider and a read-out of its value. `mark` puts a tick at the default. */
function slider(name: string, label: string, [min, max]: readonly [number, number], step: number, mark: number) {
  const marks = create("datalist", { id: `${name}-marks` });
  marks.append(create("option", { value: String(mark) }));
  const input = create("input", { id: name, name, type: "range", min: String(min), max: String(max) });
  input.step = String(step);
  input.setAttribute("list", marks.id);
  const output = create("output");
  output.htmlFor.add(name);
  return { input, output, nodes: [create("label", { htmlFor: name, textContent: label }), input, output, marks] };
}

/**
 * Fills `form` with the settings controls and keeps them in step with storage: every change
 * is saved at once, and what was saved (after clamping) is shown back.
 */
export function mountSettingsForm(form: HTMLFormElement) {
  form.classList.add("settings");
  const voice = create("select", { id: "voice", name: "voice" });
  for (const [index, name] of VOICES.entries()) voice.add(new Option(name, String(index)));
  const speed = slider("speed", "Speed", LIMITS.speed, 0.05, 1);
  const pitchShift = slider("pitchShift", "Pitch", [-6, 6], 0.5, 0); // shown in semitones
  const pitchRange = slider("pitchRange", "Expressiveness", LIMITS.pitchRange, 0.05, 1);
  const prefetch = create("input", { id: "prefetch", name: "prefetch", type: "number", step: "1" });
  [prefetch.min, prefetch.max] = PREFETCH_LIMITS.map(String) as [string, string];
  prefetch.setAttribute("aria-describedby", "prefetch-hint");
  const reset = create("button", { type: "button", id: "reset", textContent: "Reset to defaults" });
  const saved = create("span", { id: "saved" });
  saved.setAttribute("role", "status");
  saved.setAttribute("aria-live", "polite");
  const row = create("div", { className: "row" });
  row.append(reset, saved);
  form.append(
    create("label", { htmlFor: "voice", textContent: "Voice" }),
    voice,
    ...speed.nodes,
    ...pitchShift.nodes,
    ...pitchRange.nodes,
    create("label", { htmlFor: "prefetch", textContent: "Sentences ahead" }),
    prefetch,
    create("span", {
      className: "hint",
      id: "prefetch-hint",
      textContent: "How many sentences are prepared in advance. More is smoother and uses more memory.",
    }),
    row,
  );

  function describe() {
    const semitones = Number(pitchShift.input.value);
    speed.output.value = `${Number(speed.input.value).toFixed(2)}×`;
    pitchShift.output.value = `${semitones > 0 ? "+" : ""}${semitones} st`;
    pitchRange.output.value = `${Math.round(Number(pitchRange.input.value) * 100)}%`;
  }

  function show(settings: Settings) {
    voice.value = String(settings.voice);
    speed.input.value = String(settings.speed);
    pitchShift.input.value = String(Math.round((settings.pitchShift / SEMITONE) * 2) / 2);
    pitchRange.input.value = String(settings.pitchRange);
    prefetch.value = String(settings.prefetch);
    describe();
  }

  const read = (): Settings => ({
    voice: Number(voice.value),
    speed: Number(speed.input.value),
    pitchShift: Number(pitchShift.input.value) * SEMITONE,
    pitchRange: Number(pitchRange.input.value),
    // NaN for an emptied field, which saveSettings turns back into the default.
    prefetch: prefetch.valueAsNumber,
  });

  // Saves run one at a time, in the order the changes were made: two overlapping saves could
  // otherwise store the older one last. Only the newest result is shown back, so a slow save
  // never undoes what was changed since.
  let queue: Promise<void> = Promise.resolve();
  let newest = 0;
  function save(settings: Settings) {
    const mine = ++newest;
    queue = queue
      .then(async () => {
        const stored = await saveSettings(settings);
        if (mine !== newest) return;
        show(stored);
        saved.textContent = "Saved. Used from the next reading.";
      })
      .catch(() => {
        saved.textContent = "The settings could not be saved.";
      });
    return queue;
  }

  form.addEventListener("input", describe);
  form.addEventListener("change", () => void save(read()));
  form.addEventListener("submit", (event) => event.preventDefault());
  reset.addEventListener("click", () => void save(DEFAULT_SETTINGS));
  return loadSettings().then(show);
}
