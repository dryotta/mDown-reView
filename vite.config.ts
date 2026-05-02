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
 * Copy Excalidraw runtime assets (fonts + data only) from node_modules
 * into `public/excalidraw-assets/` so the app can self-host them at
 * runtime (CSP `font-src 'self' data:`, AGENTS.md offline constraint).
 * `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"` is set at
 * module-scope in `ExcalidrawView` before `<Excalidraw>` mounts.
 *
 * Source path note: @excalidraw/excalidraw 0.18.x ships its prod runtime
 * assets under `dist/prod/` with `fonts/`, `locales/`, `data/`. Locales
 * are deliberately **excluded** (issue #352 / iter-12 Lean cut B14): the
 * 55 locale chunks add ~1.6 MB to the install with no user benefit —
 * mdownreview is English-only (`langCode="en"` is hard-coded in
 * `ExcalidrawView.tsx`) and Excalidraw silently falls back to English
 * when a locale chunk 404s. If a future release adds i18n, copy
 * `locales/` selectively for the locales we ship.
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
    // Issue #352 / iter-12 Lean cut B14: copy ONLY the directories
    // Excalidraw needs at runtime for our English-only mount. The
    // upstream `dist/prod/` directory also contains chunked locale
    // bundles (~1.6 MB) which we never load.
    for (const subdir of ["fonts", "data"] as const) {
      const subSrc = resolve(src, subdir);
      const subDst = resolve(dst, subdir);
      if (existsSync(subSrc)) {
        cpSync(subSrc, subDst, { recursive: true });
      }
    }
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
