import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { HIGHLIGHT_CSS } from "@/content/highlight.ts";
import { createRouter, type WorkerLike } from "@/engine/router.ts";
import type { ReaderCommand } from "./reader.content.ts";

const MENU_READ = "read-selection";

// MV3 event page. It owns the engine Worker: Firefox suspends this page about 30 s after the
// last message from a reading page, and the Worker with the loaded model goes with it.
export default defineBackground(() => {
	const router = createRouter(
		() =>
			new Worker(
				browser.runtime.getURL("/engine-worker.js"),
			) as unknown as WorkerLike,
	);
	browser.runtime.onConnect.addListener((port) => router.connect(port));

	/**
	 * Injects the reader into one frame (allowed by activeTab after a menu click or a
	 * shortcut) and sends it a command. Fails quietly where add-ons may not run, such as
	 * about: pages and frames from another site.
	 */
	async function send(tabId: number, frameId: number, command: ReaderCommand) {
		try {
			const target = { tabId, frameIds: [frameId] };
			const [injection] = await browser.scripting.executeScript({
				target,
				files: ["/content-scripts/reader.js"],
			});
			// First injection into this document: add the highlight colours too.
			if (injection?.result === true)
				await browser.scripting.insertCSS({ target, css: HIGHLIGHT_CSS });
			await browser.tabs.sendMessage(tabId, command, { frameId });
		} catch (error) {
			console.warn("Tiny Reader cannot read this page:", error);
		}
	}

	// Menus persist across event-page restarts, so they are created once, at install.
	browser.runtime.onInstalled.addListener(() => {
		browser.contextMenus.create({
			id: MENU_READ,
			title: "Read with tiny-voca",
			contexts: ["selection"],
		});
		// `pnpm dev` opens the engine test page.
		if (import.meta.env.DEV)
			browser.tabs.create({ url: browser.runtime.getURL("/playground.html") });
	});
	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === MENU_READ && tab?.id !== undefined)
			void send(tab.id, info.frameId ?? 0, { type: "read-selection" });
	});
});
