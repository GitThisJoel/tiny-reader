// The panel that opens from the toolbar button: start a reading, control it, change settings.
// Opening it is a user action on the tab, so the add-on may reach that tab (activeTab).
import { browser } from "wxt/browser";
import {
  BLOCKED,
  type Command,
  type CommandMessage,
  PAGE_STATE,
  type PageState,
  PDF_BLOCKED,
} from "@/content/commands.ts";
import { iconButton } from "@/content/icons.ts";
import { mountSettingsForm } from "@/content/settings-form.ts";

/** Asks the background to pass a command to the reader in the active tab. False: it could not start. */
const send = (name: Command): Promise<boolean> =>
  browser.runtime.sendMessage({ type: "command", name } satisfies CommandMessage);

const hint = document.getElementById("read-hint") as HTMLElement;
/** Replaces the hint under Read aloud with the reason this page cannot be read. */
function warn(message: string) {
  hint.textContent = message;
  hint.setAttribute("role", "alert");
}

/** Opens the add-on's document page. `name` tells it which file the user was looking at. */
async function openDocumentPage(name?: string) {
  const fragment = name ? `#name=${encodeURIComponent(name)}` : "";
  await browser.tabs.create({ url: browser.runtime.getURL("/document.html") + fragment });
  window.close();
}

document.getElementById("read")?.addEventListener("click", async () => {
  if (await send("read")) {
    // Out of the way: the page shows the control bar now.
    window.close();
    return;
  }
  warn(BLOCKED);
});

// Where the page cannot be read in place, say so at once and offer the way that works.
browser.runtime.sendMessage({ type: PAGE_STATE }).then((state: PageState) => {
  document.body.dataset.page = state.kind;
  if (state.kind === "readable") return;
  warn(state.kind === "pdf" ? PDF_BLOCKED : BLOCKED);
  if (state.kind !== "pdf") return;
  const open = document.createElement("button");
  open.type = "button";
  open.id = "open-pdf";
  open.textContent = "Open this PDF in Tiny Reader…";
  open.addEventListener("click", () => void openDocumentPage(state.name));
  hint.after(open);
});

document.getElementById("controls")?.append(
  iconButton("previous", "Previous sentence", () => void send("previous")),
  iconButton("toggle", "Pause or resume", () => void send("toggle")),
  iconButton("next", "Next sentence", () => void send("next")),
  iconButton("stop", "Stop reading", () => void send("stop")),
);

document.getElementById("pdf")?.addEventListener("click", () => void openDocumentPage());

document.getElementById("shortcuts")?.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

void mountSettingsForm(document.getElementById("form") as HTMLFormElement);
