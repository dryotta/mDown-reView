/**
 * Issue #352 / iter-12 — regression tests for `computeSceneSnapshot`.
 *
 * Critical invariants this test locks:
 *
 *   1. **AppState is included in the hash** (bug-expert finding
 *      CRITICAL#1). The previous `stableContentHash` only covered
 *      `(elements, libraryItems)`; pure-appState edits silently
 *      bypassed the save IPC.
 *
 *   2. **Volatile element fields don't shift the hash** — Excalidraw
 *      bumps `version` / `versionNonce` / `updated` on every onChange
 *      (including mount-time normalisation). If those entered the
 *      hash, the FIRST onChange post-mount would drive a save.
 *
 *   3. **`.excalidrawlib` files key on `libraryItems`** only —
 *      element + appState fields are irrelevant.
 *
 *   4. **PNG/SVG variants share the same canonical-scene hash** — we
 *      hash the persisted scene, not the rendered raster.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawScene } from "../extractScene";
import {
  __TEST_ONLY_PERSISTED_APPSTATE_KEYS,
  computeSceneSnapshot,
} from "../stable-hash";

const EMPTY_SCENE: ExcalidrawScene = {
  elements: [],
  appState: {},
  files: {},
  libraryItems: null,
};

describe("computeSceneSnapshot", () => {
  it("two identical scenes hash equal", () => {
    const a = computeSceneSnapshot("/foo.excalidraw", EMPTY_SCENE);
    const b = computeSceneSnapshot("/foo.excalidraw", EMPTY_SCENE);
    expect(a).toBe(b);
  });

  it("appState `viewBackgroundColor` change shifts the hash (CRITICAL#1 regression)", () => {
    const before = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: { viewBackgroundColor: "#ffffff" },
    });
    const after = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: { viewBackgroundColor: "#000000" },
    });
    expect(before).not.toBe(after);
  });

  it("appState `gridModeEnabled` change shifts the hash", () => {
    const before = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: { gridModeEnabled: false },
    });
    const after = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: { gridModeEnabled: true },
    });
    expect(before).not.toBe(after);
  });

  it("element `versionNonce` change does NOT shift the hash (mount stability)", () => {
    const e1 = { id: "a", type: "rectangle", x: 0, y: 0, version: 1, versionNonce: 100 };
    const e2 = { id: "a", type: "rectangle", x: 0, y: 0, version: 99, versionNonce: 9999 };
    const a = computeSceneSnapshot("/foo.excalidraw", { ...EMPTY_SCENE, elements: [e1] });
    const b = computeSceneSnapshot("/foo.excalidraw", { ...EMPTY_SCENE, elements: [e2] });
    expect(a).toBe(b);
  });

  it("element `x`/`y` change DOES shift the hash (real edit)", () => {
    const e1 = { id: "a", type: "rectangle", x: 0, y: 0 };
    const e2 = { id: "a", type: "rectangle", x: 100, y: 0 };
    const a = computeSceneSnapshot("/foo.excalidraw", { ...EMPTY_SCENE, elements: [e1] });
    const b = computeSceneSnapshot("/foo.excalidraw", { ...EMPTY_SCENE, elements: [e2] });
    expect(a).not.toBe(b);
  });

  it("`.excalidrawlib` snapshot ignores elements (only libraryItems matters)", () => {
    const a = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      elements: [{ id: "ignored" }],
      libraryItems: [{ id: "lib1", elements: [] }],
    });
    const b = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      elements: [], // different elements
      libraryItems: [{ id: "lib1", elements: [] }],
    });
    expect(a).toBe(b);
  });

  it("`.excalidrawlib` snapshot shifts when libraryItems content shifts", () => {
    const a = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      libraryItems: [{ id: "lib1", name: "old" }],
    });
    const b = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      libraryItems: [{ id: "lib1", name: "new" }],
    });
    expect(a).not.toBe(b);
  });

  it("library items volatile element fields ALSO get stripped", () => {
    const a = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      libraryItems: [
        {
          id: "lib1",
          elements: [{ id: "inner", versionNonce: 1, version: 1 }],
        },
      ],
    });
    const b = computeSceneSnapshot("/lib.excalidrawlib", {
      ...EMPTY_SCENE,
      libraryItems: [
        {
          id: "lib1",
          elements: [{ id: "inner", versionNonce: 9999, version: 99 }],
        },
      ],
    });
    expect(a).toBe(b);
  });

  it("PNG and SVG variants hash by the same canonical-scene rules", () => {
    const scene = {
      ...EMPTY_SCENE,
      elements: [{ id: "e1", x: 1, y: 1 }],
      appState: { viewBackgroundColor: "#abcdef" },
    };
    const png = computeSceneSnapshot("/foo.excalidraw.png", scene);
    const svg = computeSceneSnapshot("/foo.excalidraw.svg", scene);
    expect(png).toBe(svg);
  });

  it("non-persisted appState keys (cursor / scroll / selection) do NOT shift the hash", () => {
    // Volatile non-persisted appState keys — included in raw appState
    // but NOT in `cleanAppStateForExport`'s output. Hashing them would
    // drive a save on every viewport pan / cursor move.
    const baseAppState = { viewBackgroundColor: "#ffffff", gridSize: 20 };
    const a = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: { ...baseAppState, cursorButton: "up", scrollX: 0, selectedElementIds: {} },
    });
    const b = computeSceneSnapshot("/foo.excalidraw", {
      ...EMPTY_SCENE,
      appState: {
        ...baseAppState,
        cursorButton: "down",
        scrollX: 100,
        selectedElementIds: { a: true },
      },
    });
    expect(a).toBe(b);
  });

  it("PERSISTED_APPSTATE_KEYS list matches Excalidraw's cleanAppStateForExport contract", () => {
    // Drift audit (iter-12 documentation contract): cross-check
    // against `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/appState.d.ts`'s
    // `cleanAppStateForExport` return type. As of @excalidraw/excalidraw
    // 0.18.x the persisted keys are exactly:
    //   gridModeEnabled, viewBackgroundColor, gridSize, gridStep
    // If an upgrade adds a key, this assertion fails loudly so the
    // hash function gets the new key in lockstep.
    expect(new Set(__TEST_ONLY_PERSISTED_APPSTATE_KEYS)).toEqual(
      new Set(["viewBackgroundColor", "gridModeEnabled", "gridSize", "gridStep"]),
    );
  });
});
