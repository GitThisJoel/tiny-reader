// The settings form, used by the options page and by the toolbar popup.
import { browser } from "wxt/browser";
import { deleteModel, storedModels, storeModel } from "@/engine/model-store.ts";
import { BUNDLED, downloadModel, MODELS, type Model, ModelError, modelById, modelUrl } from "@/engine/models.ts";
import { LIMITS } from "@/engine/protocol.ts";
import { sitePattern } from "./commands.ts";
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

/** "English · voices F, M · Apache-2.0 · 21 MB": what a model is, before it is downloaded. */
const describeModel = (model: Model) =>
  [
    new Intl.DisplayNames(["en"], { type: "language" }).of(model.language),
    `voices ${model.voices.join(", ")}`,
    model.licence,
    `${Math.round(model.size / 1e6)} MB`,
  ].join(" · ");

/**
 * Fills `form` with the settings controls and keeps them in step with storage: every change
 * is saved at once, and what was saved (after clamping) is shown back.
 *
 * `downloads` adds the list of voice models that can be downloaded and deleted. It is left out
 * of the toolbar popup, which closes, and takes a download with it, as soon as it loses focus.
 */
export function mountSettingsForm(form: HTMLFormElement, { downloads = false } = {}) {
  form.classList.add("settings");
  /** The ids of the downloaded models. Only these and the bundled one can be chosen. */
  const downloaded = new Set<string>();
  const model = create("select", { id: "model", name: "model" });
  const voice = create("select", { id: "voice", name: "voice" });
  /** Offers the models that can be used now, keeping the choice if it is still among them. */
  function offerModels() {
    const chosen = model.value;
    model.replaceChildren(
      ...MODELS.filter((entry) => entry === BUNDLED || downloaded.has(entry.id)).map(
        (entry) => new Option(entry.name, entry.id),
      ),
    );
    model.value = downloaded.has(chosen) ? chosen : BUNDLED.id;
    offerVoices();
  }
  /** Offers the chosen model's voices, keeping the place in the list: female comes first in each. */
  function offerVoices() {
    const chosen = voice.selectedIndex;
    const names = (modelById(model.value) ?? BUNDLED).voices;
    voice.replaceChildren(...names.map((name, index) => new Option(name, String(index))));
    voice.selectedIndex = chosen >= 0 && chosen < names.length ? chosen : 0;
  }
  // Before the form's own listener below, which saves what the controls say.
  model.addEventListener("change", offerVoices);
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
    create("label", { htmlFor: "model", textContent: "Model" }),
    model,
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

  /** What `show` was last given. */
  let shown = DEFAULT_SETTINGS;
  function showModel() {
    // A chosen model that is not in storage is not offered. The engine reads with the bundled one and says so.
    model.value = downloaded.has(shown.model) ? shown.model : BUNDLED.id;
    offerVoices();
    voice.value = String(shown.voice);
    if (voice.selectedIndex < 0) voice.selectedIndex = 0;
  }
  function show(settings: Settings) {
    shown = settings;
    showModel();
    speed.input.value = String(settings.speed);
    pitchShift.input.value = String(Math.round((settings.pitchShift / SEMITONE) * 2) / 2);
    pitchRange.input.value = String(settings.pitchRange);
    prefetch.value = String(settings.prefetch);
    describe();
  }

  /** Whether it is known which models are downloaded. Until then the form cannot say that a chosen one is gone. */
  let known = false;
  const read = (): Settings => ({
    // While storage has not been read, or cannot be, the model shown is not a choice the user made.
    model: known || model.value !== BUNDLED.id ? model.value : shown.model,
    voice: Number(voice.value),
    speed: Number(speed.input.value),
    pitchShift: Number(pitchShift.input.value) * SEMITONE,
    pitchRange: Number(pitchRange.input.value),
    // NaN for an emptied field, which saveSettings turns back into the default.
    prefetch: prefetch.valueAsNumber,
  });

  // Only the newest save's result is shown back, so a slow save never undoes what was changed since.
  let newest = 0;
  async function save(settings: Settings) {
    const mine = ++newest;
    try {
      const stored = await saveSettings(settings);
      if (mine !== newest) return;
      show(stored);
      saved.textContent = "Saved. Used from the next reading.";
    } catch {
      saved.textContent = "The settings could not be saved.";
    }
  }

  /** One model that can be downloaded: what it is, a button to download or delete it, and how that is going. */
  function modelRow(entry: Model) {
    const row = create("div", { className: "model" });
    row.dataset.model = entry.id;
    const about = create("span");
    about.append(
      create("a", { href: entry.source, target: "_blank", rel: "noreferrer", textContent: entry.name }),
      ` · ${describeModel(entry)}`,
    );
    const button = create("button", { type: "button" });
    const progress = create("progress");
    progress.max = entry.size;
    progress.setAttribute("aria-label", `Downloading ${entry.name}`);
    const status = create("span");
    status.setAttribute("role", "status");
    row.append(about, button, progress, status);

    /** The download in progress, if any. */
    let download: AbortController | null = null;
    function render(message = "") {
      const action = download ? "Cancel" : downloaded.has(entry.id) ? "Delete" : "Download";
      button.textContent = action;
      button.setAttribute("aria-label", `${action} ${entry.name}`);
      progress.hidden = !download;
      status.textContent = message || (downloaded.has(entry.id) && !download ? "Downloaded" : "");
    }
    button.addEventListener("click", async () => {
      if (download) return download.abort();
      if (downloaded.has(entry.id)) {
        try {
          await deleteModel(entry.id);
        } catch {
          return render("It could not be deleted.");
        }
        downloaded.delete(entry.id);
        const wasChosen = model.value === entry.id;
        offerModels();
        // What is gone cannot stay the choice.
        if (wasChosen) void save(read());
        return render();
      }
      // Asked for in the click itself, or Firefox shows no prompt. With access to the site the
      // request carries no Origin header, which would name this installation of the add-on; without
      // it nothing is downloaded. Access the user gave before (for a PDF there) is left as it was.
      const origins = [sitePattern(modelUrl(entry))];
      const held = browser.permissions.contains({ origins });
      // No second prompt from a second click while the first is open.
      button.disabled = true;
      const allowed = await browser.permissions.request({ origins }).catch(() => false);
      button.disabled = false;
      if (!allowed)
        return render(`Nothing was downloaded: Firefox was not allowed to reach ${new URL(modelUrl(entry)).hostname}.`);
      download = new AbortController();
      const { signal } = download;
      progress.value = 0;
      render("Downloading…");
      try {
        // The only request: the file itself, verified against the list before it is returned.
        const bytes = await downloadModel(
          entry,
          (received) => {
            progress.value = received;
          },
          signal,
        );
        await storeModel(entry.id, bytes);
        downloaded.add(entry.id);
        download = null;
        offerModels();
        render();
      } catch (error) {
        download = null;
        render(signal.aborted ? "" : error instanceof ModelError ? error.message : "The model could not be stored.");
      } finally {
        // The access was for this download only.
        if (!(await held.catch(() => true))) await browser.permissions.remove({ origins }).catch(() => {});
      }
    });
    render();
    return { row, render };
  }

  const rows = downloads ? MODELS.filter((entry) => entry !== BUNDLED).map(modelRow) : [];
  if (downloads) {
    const list = create("fieldset", { id: "models" });
    list.append(
      create("legend", { textContent: "More voices" }),
      create("p", {
        className: "hint",
        textContent:
          "Other English voices, made by others from the same model. A voice is downloaded from huggingface.co when you press Download, after Firefox has asked for your permission to reach that site. It is checked against a fingerprint Tiny Reader carries and kept on this computer. Nothing about you or what you read is sent.",
      }),
      ...rows.map(({ row }) => row),
    );
    row.before(list);
  } else {
    const more = create("button", { type: "button", id: "more-voices", textContent: "Get more voices…" });
    more.addEventListener("click", async () => {
      await browser.runtime.openOptionsPage();
      window.close(); // the popup
    });
    voice.after(more);
  }

  form.addEventListener("input", describe);
  form.addEventListener("change", () => void save(read()));
  form.addEventListener("submit", (event) => event.preventDefault());
  reset.addEventListener("click", () => void save(DEFAULT_SETTINGS));
  offerModels();
  // The settings are shown at once. Which models are downloaded takes a moment longer to find
  // out; storage that cannot be read offers the bundled model only.
  const models = storedModels()
    .then((ids) => {
      known = true;
      return ids;
    })
    .catch(() => [])
    .then((ids) => {
      for (const id of ids) downloaded.add(id);
      offerModels();
      showModel();
      for (const { render } of rows) render();
    });
  return Promise.all([loadSettings().then(show), models]);
}
