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
        ["voice", "speed", "pitchShift", "pitchRange", "prefetch"].map((name) => [name, field(name).value]),
      ),
    ).toEqual({ voice: "1", speed: "1.5", pitchShift: "-2", pitchRange: "1", prefetch: "4" });
    expect((form.querySelector('output[for="pitchShift"]') as HTMLOutputElement).value).toBe("-2 st");
    expect((form.querySelector('output[for="speed"]') as HTMLOutputElement).value).toBe("1.50×");
    for (const control of form.querySelectorAll<HTMLInputElement>("select, input"))
      expect(control.labels?.length, control.id).toBe(1);
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

  it("resets to the defaults", async () => {
    await saveSettings({ voice: 1, speed: 2 });
    await mountSettingsForm(form);
    (form.querySelector("#reset") as HTMLButtonElement).click();
    await vi.waitFor(async () => expect(await loadSettings()).toEqual(DEFAULT_SETTINGS));
    expect(field("speed").value).toBe("1");
  });
});
