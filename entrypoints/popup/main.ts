// The panel that opens from the toolbar button: start a reading, control it, change settings.
// Opening it is a user action on the tab, so the add-on may reach that tab (activeTab).
import { browser } from "wxt/browser";
import { BLOCKED, type Command, type CommandMessage } from "@/content/commands.ts";
import { iconButton } from "@/content/icons.ts";
import { mountSettingsForm } from "@/content/settings-form.ts";

/** Asks the background to pass a command to the reader in the active tab. False: it could not start. */
const send = (name: Command): Promise<boolean> =>
  browser.runtime.sendMessage({ type: "command", name } satisfies CommandMessage);

document.getElementById("read")?.addEventListener("click", async () => {
  if (await send("read")) {
    // Out of the way: the page shows the control bar now.
    window.close();
    return;
  }
  const hint = document.getElementById("read-hint") as HTMLElement;
  hint.textContent = BLOCKED;
  hint.setAttribute("role", "alert");
});

document.getElementById("controls")?.append(
  iconButton("previous", "Previous sentence", () => void send("previous")),
  iconButton("toggle", "Pause or resume", () => void send("toggle")),
  iconButton("next", "Next sentence", () => void send("next")),
  iconButton("stop", "Stop reading", () => void send("stop")),
);

document.getElementById("pdf")?.addEventListener("click", async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("/document.html") });
  window.close();
});

document.getElementById("shortcuts")?.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

void mountSettingsForm(document.getElementById("form") as HTMLFormElement);
