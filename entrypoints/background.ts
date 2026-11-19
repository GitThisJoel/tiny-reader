import { type Browser, browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { isCommand, isCommandMessage } from "@/content/commands.ts";
import { HIGHLIGHT_CSS } from "@/content/highlight.ts";
import { createRouter, type WorkerLike } from "@/engine/router.ts";
import type { ReaderCommand } from "./reader.content.ts";

const MENU_SELECTION = "read-selection";
const MENU_FROM_HERE = "read-from-here";

// Firefox's name for contextMenus. Only `menus` reports the element a menu was opened on,
// which "read from here" needs; wxt's types know the Chrome name only.
type MenuClick = Browser.contextMenus.OnClickData & {
  targetElementId?: number;
};
const menus = (browser as unknown as { menus: typeof browser.contextMenus }).menus;

// MV3 event page. It owns the engine Worker: Firefox suspends this page about 30 s after the
// last message from a reading page, and the Worker with the loaded model goes with it.
export default defineBackground(() => {
  const router = createRouter(() => new Worker(browser.runtime.getURL("/engine-worker.js")) as unknown as WorkerLike);
  browser.runtime.onConnect.addListener((port) => router.connect(port));

  /** Puts the reader and the highlight colours into one frame, or every reachable frame. */
  async function inject(tabId: number, frameId: number | undefined) {
    const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
    const injections = await browser.scripting.executeScript({ target, files: ["/content-scripts/reader.js"] });
    // First injection into a document: add the highlight colours too.
    const fresh = injections.filter((injection) => injection.result === true).map((injection) => injection.frameId);
    if (fresh.length) await browser.scripting.insertCSS({ target: { tabId, frameIds: fresh }, css: HIGHLIGHT_CSS });
  }

  /**
   * Sends the reader a command: to one frame, or to every frame the add-on may reach when
   * `frameId` is undefined. A command that starts a reading injects the reader first (allowed
   * by activeTab after a menu click or a shortcut). Fails quietly where add-ons may not run,
   * such as about: pages and frames from another site.
   */
  async function send(tabId: number, frameId: number | undefined, command: ReaderCommand) {
    const starts = command.type.startsWith("read");
    try {
      if (starts) await inject(tabId, frameId);
      await browser.tabs.sendMessage(tabId, command, frameId === undefined ? {} : { frameId });
    } catch (error) {
      // Pause, stop and skip are for a reader that is already there. With none, there is nothing to do.
      if (starts) console.warn("Tiny Reader cannot read this page:", error);
    }
  }

  // Menus persist across event-page restarts, so they are created once, at install.
  browser.runtime.onInstalled.addListener(() => {
    menus.create({
      id: MENU_SELECTION,
      title: "Read with tiny-voca",
      contexts: ["selection"],
    });
    menus.create({
      id: MENU_FROM_HERE,
      title: "Read from here with tiny-voca",
      contexts: ["page", "link"],
    });
    // `pnpm dev` opens the engine test page.
    if (import.meta.env.DEV) browser.tabs.create({ url: browser.runtime.getURL("/playground.html") });
  });
  menus.onClicked.addListener((info: MenuClick, tab) => {
    if (tab?.id === undefined) return;
    const frameId = info.frameId ?? 0;
    if (info.menuItemId === MENU_SELECTION) void send(tab.id, frameId, { type: "read-selection" });
    else if (info.menuItemId === MENU_FROM_HERE && info.targetElementId !== undefined)
      void send(tab.id, frameId, {
        type: "read-from-here",
        target: info.targetElementId,
      });
  });

  /** Passes a command to the reader in the tab the user is looking at. */
  async function toActiveTab(name: unknown) {
    if (!isCommand(name)) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    // ponytail: the command goes to every frame, since any of them may hold the selection or
    // the reading. Starting a reading in one frame does not stop one in another frame.
    if (tab?.id !== undefined) await send(tab.id, undefined, { type: name });
  }
  // Keyboard shortcuts, and the buttons of the toolbar popup.
  browser.commands.onCommand.addListener((name) => void toActiveTab(name));
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isCommandMessage(message)) return toActiveTab(message.name);
  });
});
