import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WxtVitest applies the aliases from wxt.config.ts, but not the one given there to Vite alone.
  plugins: [WxtVitest()],
  resolve: { alias: { "dizione-ptbr": resolve(import.meta.dirname, "vendor/dizione-ptbr/src") } },
});
