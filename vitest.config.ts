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
    ],
    server: {
      deps: {
        // Iter-22 (#352 test-expert iter-21 P0) — `@excalidraw/excalidraw`
        // ships ESM with extensionless internal imports
        // (`roughjs/bin/rough`) that Vitest's default resolver rejects.
        // Inlining forces vite to transform the package through esbuild,
        // which auto-resolves missing extensions. Required for the
        // round-trip CI gate (`saveScene.roundtrip.test.ts`).
        inline: ["@excalidraw/excalidraw"],
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // Iter-22 — extension-less import in Excalidraw's bundle.
      // Match must be exact (regex anchored) so we don't catch
      // `roughjs/bin/rough.js` itself.
      {
        find: /^roughjs\/bin\/rough$/,
        replacement: resolve(__dirname, "node_modules/roughjs/bin/rough.js"),
      },
    ],
  },
});
