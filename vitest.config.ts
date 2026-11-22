import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";
import { VITE_ALIAS } from "./wxt.config.ts";

export default defineConfig({
  // WxtVitest applies the aliases from wxt.config.ts, but not the one given there to Vite alone.
  plugins: [WxtVitest()],
  resolve: { alias: VITE_ALIAS },
});
