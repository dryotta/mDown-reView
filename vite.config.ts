import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
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
 * assets under `dist/prod/` with `fonts/`, `locales/`, `data/`.
 *
 * **Locales are deliberately excluded** (issue #352 / iter-12 Lean cut
 * B14): the 55 locale chunks add ~1.6 MB to the install with no user
 * benefit — mdownreview is English-only (`langCode="en"` is hard-coded
 * in `ExcalidrawView.tsx`) and Excalidraw silently falls back to
 * English when a locale chunk 404s. If a future release adds i18n,
 * copy `locales/` selectively for the locales we ship.
 *
 * **Fonts are filtered through `FONT_ALLOWLIST`** (issue #352 / iter-19
 * Lean cut B16): the upstream `dist/prod/fonts/` directory carries
 * **9 font families** weighing ~12.7 MB, dominated by `Xiaolai` (CJK,
 * 12.4 MB / 209 files / ~98% of the payload). Excalidraw's font loader
 * silently falls back to the system font when a vendored woff2 404s,
 * so removing CJK + Hebrew + display-script families is a pure size
 * win with no user-visible regression for English content.
 *
 * **Allowlist (~282 KB total):** Cascadia (monospace), ComicShanns
 * (casual), Excalifont (Excalidraw default), Liberation (Latin sans),
 * Virgil (Excalidraw signature). Drop: Assistant (Hebrew), Lilita
 * (display), Nunito (display), Xiaolai (CJK).
 *
 * If a future release targets non-English markets, append the relevant
 * family to `FONT_ALLOWLIST`.
 *
 * Idempotent: wipes the destination on every dev/build start so a stale
 * Excalidraw upgrade can't leave orphan files behind. Runs at
 * `configResolved` (before any user code is built/served) to keep dev
 * and build behaviour identical. No new dev dep (uses node:fs).
 */
const FONT_ALLOWLIST: ReadonlySet<string> = new Set([
  "Cascadia",
  "ComicShanns",
  "Excalifont",
  "Liberation",
  "Virgil",
]);

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
    // Iter-12 Lean cut B14 + iter-19 cut B16: copy ONLY the directories
    // Excalidraw needs at runtime for our English-only mount, AND only
    // the allowlisted font families inside `fonts/`. The upstream
    // `dist/prod/` also contains chunked locale bundles (~1.6 MB) and
    // CJK + display fonts (~12 MB) which we never load.
    for (const subdir of ["fonts", "data"] as const) {
      const subSrc = resolve(src, subdir);
      const subDst = resolve(dst, subdir);
      if (!existsSync(subSrc)) continue;
      if (subdir === "fonts") {
        const families = readdirSync(subSrc, { withFileTypes: true });
        for (const entry of families) {
          if (!entry.isDirectory()) continue;
          if (!FONT_ALLOWLIST.has(entry.name)) continue;
          cpSync(
            resolve(subSrc, entry.name),
            resolve(subDst, entry.name),
            { recursive: true },
          );
        }
      } else {
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
