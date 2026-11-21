import { type Browser, browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  BLOCKED,
  isCommand,
  isCommandMessage,
  PAGE_STATE,
  type PageState,
  pdfName,
  webUrl,
} from "@/content/commands.ts";
import type { ReaderCommand } from "@/content/controller.ts";
import { HIGHLIGHT_CSS } from "@/content/highlight.ts";
import { createRouter, type WorkerLike } from "@/engine/router.ts";

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
    // The add-on's own document page has the reader built in, and no add-on can inject into it.
    if ((await browser.tabs.get(tabId)).url?.startsWith(browser.runtime.getURL("/document.html"))) return;
    const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
    const injections = await browser.scripting.executeScript({ target, files: ["/content-scripts/reader.js"] });
    // First injection into a document: add the highlight colours too.
    const fresh = injections.filter((injection) => injection.result === true).map((injection) => injection.frameId);
    if (fresh.length) await browser.scripting.insertCSS({ target: { tabId, frameIds: fresh }, css: HIGHLIGHT_CSS });
  }

  /**
   * Sends the reader a command: to one frame, or to every frame the add-on may reach when
   * `frameId` is undefined. A command that starts a reading injects the reader first (allowed
   * by activeTab after a menu click or a shortcut). Resolves to false when a reading could not
   * be started: Firefox lets no add-on into Reader View, its own pages, addons.mozilla.org or,
   * with activeTab alone, frames from another site.
   */
  async function send(tabId: number, frameId: number | undefined, command: ReaderCommand): Promise<boolean> {
    const starts = command.type.startsWith("read");
    try {
      if (starts) await inject(tabId, frameId);
      await browser.tabs.sendMessage(tabId, command, frameId === undefined ? {} : { frameId });
      if (starts) await mark(tabId, false);
      return true;
    } catch (error) {
      // Pause, stop and skip are for a reader that is already there. With none, there is nothing to do.
      if (!starts) return true;
      console.warn("Tiny Reader cannot read this page:", error);
      await mark(tabId, true);
      return false;
    }
  }

  /**
   * Nothing can be shown inside a page the add-on may not enter, so the toolbar button says it:
   * a "!" badge and the reason as its tooltip, for that tab only, until the tab goes elsewhere.
   */
  async function mark(tabId: number, blocked: boolean) {
    const manifest = browser.runtime.getManifest();
    await Promise.all([
      browser.action.setBadgeText({ tabId, text: blocked ? "!" : "" }),
      browser.action.setBadgeBackgroundColor({ tabId, color: "#d70022" }),
      browser.action.setTitle({ tabId, title: blocked ? BLOCKED : (manifest.action?.default_title ?? manifest.name) }),
    ]).catch(() => {}); // the tab may be gone already
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
    if (info.menuItemId === MENU_SELECTION) void send(tab.id, frameId, { type: "read-selection" }).then(explain);
    else if (info.menuItemId === MENU_FROM_HERE && info.targetElementId !== undefined)
      void send(tab.id, frameId, { type: "read-from-here", target: info.targetElementId }).then(explain);
  });

  /** Passes a command to the reader in the tab the user is looking at. */
  async function toActiveTab(name: unknown): Promise<boolean> {
    if (!isCommand(name)) return false;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    // ponytail: the command goes to every frame, since any of them may hold the selection or
    // the reading. Starting a reading in one frame does not stop one in another frame.
    return tab?.id !== undefined && send(tab.id, undefined, { type: name });
  }

  /** A reading could not start, and nothing can be shown in the page: open the popup, which explains. */
  const explain = (started: boolean) => {
    if (!started) browser.action.openPopup().catch(() => {});
  };

  /** Whether the active tab can be read in place, found out by trying to run a script that does nothing. */
  async function pageState(): Promise<PageState> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { kind: "blocked" };
    if (tab.url?.startsWith(browser.runtime.getURL("/document.html"))) return { kind: "readable" };
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
      return { kind: "readable" };
    } catch {
      const name = pdfName(tab.url ?? "");
      return name ? { kind: "pdf", name, url: webUrl(tab.url) } : { kind: "blocked" };
    }
  }

  // Keyboard shortcuts, and the toolbar popup: its buttons, and its question about the tab.
  browser.commands.onCommand.addListener((name) => void toActiveTab(name).then(explain));
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isCommandMessage(message)) return toActiveTab(message.name);
    if ((message as { type?: unknown } | null)?.type === PAGE_STATE) return pageState();
  });
});
