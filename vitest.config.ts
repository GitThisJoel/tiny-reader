import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

// WxtVitest applies the aliases from wxt.config.ts.
export default defineConfig({ plugins: [WxtVitest()] });
