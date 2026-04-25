/**
 * T2 — viewerPrefs slice unit tests.
 *
 * Locks down the slice's three contract surfaces:
 *
 *   1. `setZoom` clamps to [ZOOM_MIN, ZOOM_MAX] and rejects non-finite values.
 *   2. `bumpZoom` is the single mutation chokepoint (in/out/reset) and is
 *      itself clamped.
 *   3. The persistence allowlist (`partialize`) includes `zoomByFiletype`
 *      but NOT `allowedRemoteImageDocs` — trust decisions are session-only.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/store/viewerPrefs";

beforeEach(() => {
  useStore.setState({ zoomByFiletype: {}, allowedRemoteImageDocs: {} });
});

describe("viewerPrefs.setZoom", () => {
  it("clamps below ZOOM_MIN", () => {
    useStore.getState().setZoom(".md", 0.001);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_MIN);
  });

  it("clamps above ZOOM_MAX", () => {
    useStore.getState().setZoom(".md", 9999);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_MAX);
  });

  it("treats non-finite values as ZOOM_DEFAULT", () => {
    useStore.getState().setZoom(".md", Number.NaN);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_DEFAULT);
    useStore.getState().setZoom(".md", Number.POSITIVE_INFINITY);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_DEFAULT);
    useStore.getState().setZoom(".md", Number.NEGATIVE_INFINITY);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_DEFAULT);
  });

  it("keeps zoom independent per filetype key", () => {
    useStore.getState().setZoom(".md", 1.5);
    useStore.getState().setZoom(".image", 2.0);
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(1.5);
    expect(useStore.getState().zoomByFiletype[".image"]).toBe(2.0);
  });
});

describe("viewerPrefs.bumpZoom", () => {
  it("'in' multiplies by ZOOM_STEP", () => {
    useStore.getState().bumpZoom(".md", "in");
    expect(useStore.getState().zoomByFiletype[".md"]).toBeCloseTo(ZOOM_STEP, 5);
  });

  it("'out' divides by ZOOM_STEP", () => {
    useStore.getState().bumpZoom(".md", "out");
    expect(useStore.getState().zoomByFiletype[".md"]).toBeCloseTo(1 / ZOOM_STEP, 5);
  });

  it("'reset' returns ZOOM_DEFAULT", () => {
    useStore.getState().setZoom(".md", 4);
    useStore.getState().bumpZoom(".md", "reset");
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_DEFAULT);
  });

  it("clamps repeated 'in' at ZOOM_MAX", () => {
    for (let i = 0; i < 200; i++) useStore.getState().bumpZoom(".md", "in");
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_MAX);
  });

  it("clamps repeated 'out' at ZOOM_MIN", () => {
    for (let i = 0; i < 200; i++) useStore.getState().bumpZoom(".md", "out");
    expect(useStore.getState().zoomByFiletype[".md"]).toBe(ZOOM_MIN);
  });

  it("starts from ZOOM_DEFAULT when no entry exists", () => {
    useStore.getState().bumpZoom(".image", "in");
    expect(useStore.getState().zoomByFiletype[".image"]).toBeCloseTo(ZOOM_DEFAULT * ZOOM_STEP, 5);
  });
});

describe("viewerPrefs.allowedRemoteImageDocs", () => {
  it("records per-doc trust", () => {
    useStore.getState().allowRemoteImagesForDoc("/foo.md");
    expect(useStore.getState().allowedRemoteImageDocs["/foo.md"]).toBe(true);
  });
});

/**
 * Persistence contract — locks the persistence allowlist by parsing the
 * `partialize` output structure. We don't import `partialize` directly
 * (it's defined inline in `src/store/index.ts`); instead we drive the
 * source of truth — set state, then read what `useStore.persist` would
 * write out via the persisted-state shape it exposes.
 *
 * A cheaper, more honest test: assert that the documented persistence
 * keys do not include `allowedRemoteImageDocs` and DO include
 * `zoomByFiletype`. We do this by reading the file as text — keeps the
 * allowlist drift visible at test time without coupling to internals.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("viewerPrefs persistence allowlist", () => {
  const storeIndex = readFileSync(resolve(process.cwd(), "src/store/index.ts"), "utf8");
  // Crude but stable: extract the partialize body and string-match keys.
  const partializeBody = storeIndex.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

  it("includes zoomByFiletype (persisted)", () => {
    expect(partializeBody).toMatch(/zoomByFiletype:\s*state\.zoomByFiletype/);
  });

  it("excludes allowedRemoteImageDocs (session-only trust)", () => {
    expect(partializeBody).not.toMatch(/allowedRemoteImageDocs/);
  });
});
