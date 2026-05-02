import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy Excalidraw runtime assets (fonts, locales, data) from node_modules
 * into `public/excalidraw-assets/` so the app can self-host them at runtime
 * (CSP `font-src 'self' data:`, AGENTS.md offline constraint). iter 2 will
 * set `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"` before mounting
 * `<Excalidraw>`.
 *
 * Source path note: @excalidraw/excalidraw 0.18.x ships its prod runtime
 * assets under `dist/prod/` (with `fonts/`, `locales/`, `data/`) rather
 * than the historical `dist/excalidraw-assets/` directory. We copy
 * `dist/prod` wholesale; the destination directory name remains
 * `public/excalidraw-assets/` per issue #352 spec.
 *
 * Idempotent: wipes the destination on every dev/build start so a stale
 * Excalidraw upgrade can't leave orphan files behind. Runs at
 * `configResolved` (before any user code is built/served) to keep dev and
 * build behaviour identical. No new dev dep (uses node:fs).
 */
const excalidrawAssetCopy = (): Plugin => ({
  name: "mdownreview-excalidraw-assets",
  configResolved() {
    const src = resolve(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod");
    const dst = resolve(__dirname, "public/excalidraw-assets");
    if (!existsSync(src)) {
      throw new Error(
        `[excalidraw-assets] source not found at ${src} — verify @excalidraw/excalidraw is installed and the dist path is current for the pinned version.`,
      );
    }
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  },
});

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), excalidrawAssetCopy()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
