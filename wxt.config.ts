import { createRequire } from "node:module";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);

export default defineConfig({
	browser: "firefox",
	manifestVersion: 3,
	imports: false,
	// Upstream's JS phonemizer, fetched by `pnpm fetch-assets`. Typed in engine/vendor.d.ts.
	alias: { "tiny-voca": "vendor/tiny-voca/js" },
	// The sources zip is for AMO review: assets are re-downloaded with `pnpm fetch-assets`.
	zip: { excludeSources: ["public/assets/**", "vendor/**"] },
	vite: () => ({
		resolve: {
			// Selects onnxruntime-web's build that loads its wasm from a URL. The default build
			// would inline the 15 MB binary into the worker script as base64.
			conditions: [
				"onnxruntime-web-use-extern-wasm",
				"module",
				"browser",
				"development|production",
			],
		},
	}),
	hooks: {
		// ONNX Runtime's wasm binary and its loader ship inside the add-on, unmodified.
		"build:publicAssets"(_, files) {
			for (const name of [
				"ort-wasm-simd-threaded.wasm",
				"ort-wasm-simd-threaded.mjs",
			])
				files.push({
					absoluteSrc: require.resolve(`onnxruntime-web/${name}`),
					relativeDest: `ort/${name}`,
				});
		},
	},
	manifest: {
		name: "Tiny Reader",
		description:
			"Reads selected web page text aloud with the tiny-voca model. Runs fully offline.",
		// Only 'self' plus wasm compilation for ONNX Runtime. No eval, no remote code.
		content_security_policy: {
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
		},
		browser_specific_settings: {
			gecko: {
				id: "tiny-reader@tiny-reader.invalid",
				// CSS Custom Highlight API. See docs/FINDINGS.md §6.
				strict_min_version: "140.0",
				data_collection_permissions: { required: ["none"] },
			},
		},
	},
});
