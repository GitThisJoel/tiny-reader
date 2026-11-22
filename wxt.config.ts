import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);

/**
 * TypeScript sources fetched by `pnpm fetch-assets`. Aliased for Vite only (and for Vitest, in vitest.config.ts),
 * so that tsc checks engine/vendor.d.ts and not code written for other compiler settings.
 */
export const VITE_ALIAS = { "dizione-ptbr": resolve(import.meta.dirname, "vendor/dizione-ptbr/src") };

export default defineConfig({
  browser: "firefox",
  manifestVersion: 3,
  imports: false,
  // The end-to-end tests make a build of their own with a stand-in voice model in the list
  // (tests/e2e/models.test.ts, engine/models.ts). It goes beside the real build, not over it.
  outDirTemplate: process.env.VITE_E2E_MODEL ? "firefox-mv3-e2e" : undefined,
  // Text front ends, fetched by `pnpm fetch-assets`. Typed in engine/vendor.d.ts.
  alias: {
    "tiny-voca": "vendor/tiny-voca/js",
    vocina: "vendor/vocina",
    "tiny-voca-es": "vendor/tiny-voca-es",
    "tiny-voca-fr": "vendor/tiny-voca-fr",
    // eSpeak NG's emscripten glue, built by scripts/build-espeak.sh.
    espeak: "vendor/espeak",
  },
  // The sources zip is for AMO review: assets are re-downloaded with `pnpm fetch-assets`.
  zip: { excludeSources: ["public/assets/**", "vendor/**", "tmp/**", "docs/screenshots/**", "AGENTS.md"] },
  vite: () => ({
    resolve: {
      alias: VITE_ALIAS,
      // Selects onnxruntime-web's build that loads its wasm from a URL. The default build
      // would inline the 15 MB binary into the worker script as base64.
      conditions: ["onnxruntime-web-use-extern-wasm", "module", "browser", "development|production"],
    },
  }),
  hooks: {
    // A package to publish never carries the tests' stand-in model, whatever the shell has exported.
    "zip:start"() {
      if (process.env.VITE_E2E_MODEL) throw new Error("VITE_E2E_MODEL is set: unset it before packaging.");
    },
    // ONNX Runtime's wasm binary and its loader ship inside the add-on, unmodified.
    "build:publicAssets"(_, files) {
      for (const name of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"])
        files.push({
          absoluteSrc: require.resolve(`onnxruntime-web/${name}`),
          relativeDest: `ort/${name}`,
        });
      // The licences go with every copy of the add-on, as they require.
      for (const name of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md"])
        files.push({ absoluteSrc: resolve(import.meta.dirname, name), relativeDest: `licenses/${name}` });
    },
  },
  manifest: {
    name: "Tiny Reader",
    icons: { 48: "icon.svg", 96: "icon.svg" },
    // The toolbar button. Its popup is entrypoints/popup.
    action: { default_title: "Tiny Reader", default_icon: "icon.svg" },
    // Each permission is justified in the README.
    permissions: ["activeTab", "scripting", "menus", "storage"],
    // Never granted at install. Asked for one site at a time: when the user opens a PDF from that
    // site in the add-on's document page, so that the add-on can download it, and for the site a
    // voice model comes from (the hosts in engine/models.ts) while it is downloaded from the settings page.
    optional_host_permissions: ["*://*/*"],
    // Defaults only; every key can be changed in Firefox's "Manage Extension Shortcuts".
    commands: {
      "read-selection": {
        suggested_key: { default: "Alt+Shift+R" },
        description: "Read the selected text",
      },
      toggle: {
        suggested_key: { default: "Alt+Shift+P" },
        description: "Pause or resume reading",
      },
      stop: {
        suggested_key: { default: "Alt+Shift+X" },
        description: "Stop reading",
      },
      next: { description: "Next sentence" },
      previous: { description: "Previous sentence" },
    },
    description: "Reads selected web page text aloud with the tiny-voca model. Runs fully offline.",
    // Only 'self' plus wasm compilation for ONNX Runtime. No eval, no remote code.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    browser_specific_settings: {
      gecko: {
        id: "tiny-reader@tiny-reader",
        // CSS Custom Highlight API. See docs/FINDINGS.md §5.
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
  },
});
