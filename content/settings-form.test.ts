// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_SETTINGS, loadSettings, SEMITONE, saveSettings } from "./settings.ts";
import { mountSettingsForm } from "./settings-form.ts";

let form: HTMLFormElement;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
/** What the user does: change a control's value and leave it. */
async function change(name: string, value: string) {
  const saved = form.querySelector("#saved") as HTMLElement;
  saved.textContent = "";
  field(name).value = value;
  field(name).dispatchEvent(new Event("input", { bubbles: true }));
  field(name).dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(form.querySelector("#saved")?.textContent).toMatch(/^Saved/));
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = `<form id="form"></form>`;
  form = document.getElementById("form") as HTMLFormElement;
});

describe("mountSettingsForm", () => {
  it("shows the stored settings, with a label on every control", async () => {
    await saveSettings({ voice: 1, speed: 1.5, pitchShift: -2 * SEMITONE, prefetch: 4 });
    await mountSettingsForm(form);
    expect(
      Object.fromEntries(
        ["model", "voice", "speed", "pitchShift", "pitchRange", "prefetch"].map((name) => [name, field(name).value]),
      ),
    ).toEqual({ model: "tiny-voca", voice: "1", speed: "1.5", pitchShift: "-2", pitchRange: "1", prefetch: "4" });
    expect((form.querySelector('output[for="pitchShift"]') as HTMLOutputElement).value).toBe("-2 st");
    expect((form.querySelector('output[for="speed"]') as HTMLOutputElement).value).toBe("1.50×");
    for (const control of form.querySelectorAll<HTMLInputElement>("select, input"))
      expect(control.labels?.length, control.id).toBe(1);
  });

  // jsdom has no IndexedDB, as a profile whose storage cannot be read: no model is downloaded.
  it("offers only the bundled model and its voices when nothing is downloaded", async () => {
    // A model chosen earlier whose file is gone: the engine falls back to the bundled one, and so does the form.
    await saveSettings({ model: "fiato", voice: 1 });
    await mountSettingsForm(form);
    const texts = (name: string) =>
      [...(field(name) as unknown as HTMLSelectElement).options].map((option) => option.text);
    expect(texts("model")).toEqual(["tiny-voca (English)"]);
    expect(texts("voice")).toEqual(["F2", "M2"]);
    expect([field("model").value, field("voice").value]).toEqual(["tiny-voca", "1"]);
    // The popup has no downloads, only the way to them.
    expect(form.querySelector("#models")).toBeNull();
    expect(form.querySelector("#more-voices")?.textContent).toBe("Get more voices…");
  });

  it("lists the models that can be downloaded, with what they are and where they come from", async () => {
    await mountSettingsForm(form, { downloads: true });
    expect(form.querySelector("#more-voices")).toBeNull();
    expect(
      [...form.querySelectorAll<HTMLElement>("#models .model")].map((row) => [
        row.dataset.model,
        row.querySelector("span")?.textContent,
        row.querySelector("a")?.href,
        row.querySelector("button")?.getAttribute("aria-label"),
        row.querySelector("progress")?.hidden,
      ]),
    ).toEqual([
      [
        "sobbie",
        "SobbieTTS · by PatnaikAshish · English · voices F, M · Apache-2.0 · 21 MB",
        "https://huggingface.co/PatnaikAshish/SobbieTTS",
        "Download SobbieTTS",
        true,
      ],
      [
        "fiato",
        "fiato · by cfahlgren1 · English · voices F1, M1 · Apache-2.0 · 21 MB",
        "https://huggingface.co/cfahlgren1/fiato",
        "Download fiato",
        true,
      ],
      [
        "tiny-voca-ptbr",
        "tiny-voca-ptbr · by SemFence (Gustavo Toledo) · Brazilian Portuguese · voices F_s4, M_sm4 · CC-BY-4.0 · 21 MB",
        "https://huggingface.co/semfence/tiny-voca-ptbr",
        "Download tiny-voca-ptbr",
        true,
      ],
      [
        "vocina",
        "vocina · by OfficinePixel · Italian · voices I1, I2 · Apache-2.0 · 21 MB",
        "https://github.com/OfficinePixel/vocina",
        "Download vocina",
        true,
      ],
    ]);
  });

  it("keeps a chosen model it cannot offer while it does not know what is downloaded", async () => {
    await saveSettings({ model: "fiato", voice: 1 });
    await mountSettingsForm(form);
    await change("speed", "1.3");
    expect(await loadSettings()).toMatchObject({ model: "fiato", voice: 1, speed: 1.3 });
  });

  it("saves a change at once", async () => {
    await mountSettingsForm(form);
    await change("speed", "1.3");
    await change("voice", "1");
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, speed: 1.3, voice: 1 });
  });

  it("stores pitch in the model's unit and shows it in semitones", async () => {
    await mountSettingsForm(form);
    await change("pitchShift", "3");
    expect((await loadSettings()).pitchShift).toBeCloseTo(3 * SEMITONE, 10);
    expect((form.querySelector('output[for="pitchShift"]') as HTMLOutputElement).value).toBe("+3 st");
  });

  it("shows back what was actually stored after clamping, and the default for an emptied field", async () => {
    await mountSettingsForm(form);
    await change("prefetch", "99");
    expect(field("prefetch").value).toBe("5");
    await change("prefetch", "");
    expect(field("prefetch").value).toBe(String(DEFAULT_SETTINGS.prefetch));
  });

  it("keeps both of two quick changes, even when the first save is slow", async () => {
    await mountSettingsForm(form);
    // The first write to storage takes its time, so the second change overlaps it.
    const write = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    let slow = true;
    const spy = vi.spyOn(fakeBrowser.storage.local, "set").mockImplementation(async (items) => {
      if (slow) {
        slow = false;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return write(items);
    });
    for (const [name, value] of [
      ["speed", "1.3"],
      ["voice", "1"],
    ] as const) {
      field(name).value = value;
      field(name).dispatchEvent(new Event("change", { bubbles: true }));
    }
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await loadSettings()).toMatchObject({ speed: 1.3, voice: 1 }));
    expect([field("speed").value, field("voice").value]).toEqual(["1.3", "1"]);
    spy.mockRestore();
  });

  it("resets to the defaults", async () => {
    await saveSettings({ voice: 1, speed: 2 });
    await mountSettingsForm(form);
    (form.querySelector("#reset") as HTMLButtonElement).click();
    await vi.waitFor(async () => expect(await loadSettings()).toEqual(DEFAULT_SETTINGS));
    expect(field("speed").value).toBe("1");
  });
});
