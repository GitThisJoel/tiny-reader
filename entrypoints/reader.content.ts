// Injected on demand into the active tab (activeTab + scripting), never declared for all sites.
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createController, type ReaderCommand } from "@/content/controller.ts";

const LOADED = Symbol.for("tiny-reader.loaded");

export default defineContentScript({
  registration: "runtime",
  main() {
    // executeScript may run this file again in the same page; set up only once.
    // The return value tells the background whether this was the first time.
    const scope = globalThis as { [LOADED]?: boolean };
    if (scope[LOADED]) return false;
    scope[LOADED] = true;

    const controller = createController();
    browser.runtime.onMessage.addListener((message: ReaderCommand) => controller.handle(message));
    return true;
  },
});
