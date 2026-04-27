import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    onUnhandledError: "fail",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", ".claude/**/*.test.{ts,tsx}", "eslint-rules/**/*.test.js", "scripts/**/*.test.mjs"],
    exclude: [
      "node_modules",
      "e2e",
      ...(process.env.EXPLORE_UX_SMOKE === "1" ? [] : ["**/*.smoke.test.ts"]),
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
