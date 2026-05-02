/**
 * Issue #352 / iter-12 — autosave divergence-detection key.
 *
 * Computes a deterministic hash of an Excalidraw scene that is **stable
 * across mount-time normalisation** (so opening a file doesn't trigger a
 * save) and is a **strict superset of what `saveExcalidrawFile`
 * (`saveScene.ts`) actually persists** (so pure-`appState` edits are
 * never silently dropped).
 *
 * Scope:
 *   - **Elements**: hashed minus the volatile triple `version`,
 *     `versionNonce`, `updated`. Excalidraw bumps these on every onChange
 *     (including mount-time normalisation passes for font load + library
 *     merge). Stripping them eliminates the iter-7/iter-9 "save fires on
 *     mount" class of bugs.
 *   - **Library items**: same strip applied, including to the nested
 *     `elements` arrays inside library items.
 *   - **AppState (NEW in iter-12, fixes data-loss bug #1)**: hashed via
 *     a curated allowlist of persisted-by-`serializeAsJSON` keys. The
 *     previous implementation hashed only `(elements, libraryItems)` —
 *     so a pure-appState edit (background colour, grid toggle, default
 *     stroke colour change) produced `live === baseline` and the IPC was
 *     silently skipped. The save serializer DOES persist these fields,
 *     so the divergence check missed real edits.
 *
 * **Drift hazard**: `PERSISTED_APPSTATE_KEYS` below must stay in sync
 * with what Excalidraw's own `cleanAppStateForExport` (called inside
 * `serializeAsJSON`) actually writes. Audit on every Excalidraw upgrade.
 * The unit test `stable-hash.test.ts` asserts the union of keys via
 * `serializeAsJSON` round-trip against a fixture scene with every key
 * mutated; an upgrade that adds a persisted key fails that test.
 *
 * Performance posture:
 *   - Called only at save-attempt time (debounced
 *     `EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS` + flush events), never per
 *     `onChange` tick. The previous implementation was called inside the
 *     Excalidraw onChange callback (a 2k+ Hz event surface during
 *     freehand drag) — see iter-12 perf finding HIGH#1.
 */

import type { ExcalidrawScene } from "./extractScene";

/**
 * Curated allowlist of `appState` keys that Excalidraw's
 * `cleanAppStateForExport` actually persists to disk (called inside
 * `serializeAsJSON`). Sourced from the type declarations in
 * `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/appState.d.ts`
 * (the return type of `cleanAppStateForExport`):
 *
 *   gridModeEnabled, viewBackgroundColor, gridSize, gridStep
 *
 * **Drift audit on every Excalidraw upgrade**: open
 * `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/appState.d.ts`
 * and confirm `cleanAppStateForExport`'s return type matches. The unit
 * test in `stable-hash.test.ts` locks the key set; an upgrade that adds
 * a persisted key fails that test loudly.
 */
const PERSISTED_APPSTATE_KEYS = [
  "viewBackgroundColor",
  "gridModeEnabled",
  "gridSize",
  "gridStep",
] as const;

function stripVolatile(el: unknown): Record<string, unknown> {
  if (el === null || typeof el !== "object") return {};
  const { version: _v, versionNonce: _vn, updated: _u, ...rest } =
    el as Record<string, unknown>;
  return rest;
}

/**
 * Compute the divergence-detection snapshot for a scene at the given
 * filePath. Two scenes hash equal iff a save would write byte-identical
 * content (modulo volatile element fields that don't survive a load
 * round-trip).
 */
export function computeSceneSnapshot(
  filePath: string,
  scene: ExcalidrawScene,
): string {
  const lower = filePath.toLowerCase();

  // Library files persist `libraryItems` as the top-level array; element
  // / appState content is irrelevant.
  if (lower.endsWith(".excalidrawlib")) {
    const libItems = scene.libraryItems ?? [];
    const stableLib = libItems.map((item) => {
      const stripped = stripVolatile(item);
      const innerElements = Array.isArray(stripped.elements)
        ? (stripped.elements as unknown[]).map(stripVolatile)
        : stripped.elements;
      return { ...stripped, elements: innerElements };
    });
    return JSON.stringify({ kind: "lib", libraryItems: stableLib });
  }

  // Canonical scene + PNG/SVG variants — same persisted form (PNG/SVG
  // wrap the same JSON in a chunk/metadata, so divergence is keyed on
  // the underlying scene, not the rendered raster).
  const stableElements = scene.elements.map(stripVolatile);
  const stableLib =
    scene.libraryItems !== null && scene.libraryItems !== undefined
      ? scene.libraryItems.map((item) => {
          const stripped = stripVolatile(item);
          const innerElements = Array.isArray(stripped.elements)
            ? (stripped.elements as unknown[]).map(stripVolatile)
            : stripped.elements;
          return { ...stripped, elements: innerElements };
        })
      : null;

  const a = (scene.appState ?? {}) as Record<string, unknown>;
  const persistedAppState: Record<string, unknown> = {};
  for (const k of PERSISTED_APPSTATE_KEYS) {
    if (k in a) persistedAppState[k] = a[k];
  }

  return JSON.stringify({
    kind: "scene",
    elements: stableElements,
    libraryItems: stableLib,
    appState: persistedAppState,
  });
}

/** Test-only export — keeps the curated key list inspectable for the
 *  drift-audit unit test without leaking it into the public API. */
export const __TEST_ONLY_PERSISTED_APPSTATE_KEYS = PERSISTED_APPSTATE_KEYS;

