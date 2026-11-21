import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);

export default defineConfig({
  browser: "firefox",
  manifestVersion: 3,
  imports: false,
  // Upstream's JS phonemizer, fetched by `pnpm fetch-assets`. Typed in engine/vendor.d.ts.
  alias: { "tiny-voca": "vendor/tiny-voca/js" },
  // The sources zip is for AMO review: assets are re-downloaded with `pnpm fetch-assets`.
  zip: { excludeSources: ["public/assets/**", "vendor/**", "docs/screenshots/**"] },
  vite: () => ({
    resolve: {
      // Selects onnxruntime-web's build that loads its wasm from a URL. The default build
      // would inline the 15 MB binary into the worker script as base64.
      conditions: ["onnxruntime-web-use-extern-wasm", "module", "browser", "development|production"],
    },
  }),
  hooks: {
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
    // Never granted at install. Asked for one site at a time, when the user opens a PDF from that
    // site in the add-on's document page, so that the add-on can download it.
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
        // CSS Custom Highlight API. See docs/FINDINGS.md §6.
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
  },
});
