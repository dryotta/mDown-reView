/**
 * Lock-down test for the `mdownreview:excalidraw-save-request` DOM event
 * name (issue #352 / AC5).
 *
 * The event name is duplicated as a string in three places:
 *   1. `src/components/viewers/ExcalidrawView.tsx` — exported constant
 *      `EXCALIDRAW_SAVE_REQUEST` (the listener side).
 *   2. `src/App.tsx` — top-toolbar Save button (iter-5 user-reported
 *      change moved Save from per-viewer toolbar to the app toolbar).
 *      Must NOT import from `ExcalidrawView.tsx` — that would defeat
 *      the lazy-chunk boundary.
 *   3. `src/hooks/useGlobalShortcuts.ts` — Ctrl+S handler. Same
 *      lazy-chunk reasoning.
 *
 * If the constant in `ExcalidrawView.tsx` drifts from the duplicated
 * strings in the other two files, save-button clicks and Ctrl+S
 * keystrokes will silently no-op.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_NAME = "mdownreview:excalidraw-save-request";

function read(rel: string): string {
  // Tests are co-located in `src/__tests__/`, so HERE is at
  // `D:\...\src\__tests__`. Resolve relative to `src/`.
  return readFileSync(resolve(HERE, "..", rel), "utf8");
}

describe("excalidraw-save-request event name parity (#352)", () => {
  it("ExcalidrawView.tsx exports the canonical constant", () => {
    const src = read("components/viewers/ExcalidrawView.tsx");
    expect(src).toContain(`export const EXCALIDRAW_SAVE_REQUEST = "${EXPECTED_NAME}"`);
  });

  it("App.tsx uses the same string (lazy-chunk-safe duplicate)", () => {
    const src = read("App.tsx");
    expect(src).toContain(`"${EXPECTED_NAME}"`);
    // Negative: must NOT statically import the lazy ExcalidrawView module
    // for the constant — that would eagerly load the @excalidraw/excalidraw
    // chunk into the main bundle.
    expect(src).not.toMatch(/^import .*EXCALIDRAW_SAVE_REQUEST.* from .*ExcalidrawView/m);
  });

  it("useGlobalShortcuts.ts uses the same string (lazy-chunk-safe duplicate)", () => {
    const src = read("hooks/useGlobalShortcuts.ts");
    expect(src).toContain(`"${EXPECTED_NAME}"`);
    expect(src).not.toMatch(/^import .* from .*ExcalidrawView/m);
  });
});
