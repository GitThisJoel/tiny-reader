import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createRouter, type WorkerLike } from "@/engine/router.ts";

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

	if (import.meta.env.DEV) {
		// `pnpm dev` opens the engine test page.
		browser.runtime.onInstalled.addListener(() => {
			browser.tabs.create({ url: browser.runtime.getURL("/playground.html") });
		});
	}
});
