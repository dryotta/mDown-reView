/**
 * Tests for `saveExcalidrawFile` (issue #352 / AC5) — the lazy-chunk-only
 * serializer that routes Excalidraw scene saves to the workspace-write
 * IPC chokepoint.
 *
 * Lock-down assertions:
 *   - `.excalidraw` → calls `serializeAsJSON` and writes the **verbatim**
 *     return string (no pretty-print, no JSON.stringify rewrap)
 *   - `.excalidrawlib` → calls `serializeLibraryAsJSON`
 *   - `.excalidraw.png` → calls `exportToBlob` with `mimeType: "image/png"`
 *     and `exportEmbedScene: true`, then `writeWorkspaceBinary`
 *   - `.excalidraw.svg` → calls `exportToSvg` with `exportEmbedScene: true`,
 *     then `writeWorkspaceBinary`
 *   - unsupported extension throws a `saveExcalidrawFile: unsupported
 *     extension` error
 *
 * Mocks:
 *   - `@excalidraw/excalidraw` — vi.mock with the four save APIs, each
 *     returning a deterministic spy result.
 *   - `@/lib/tauri-commands` — vi.mock for `writeWorkspaceText` and
 *     `writeWorkspaceBinary` so we can assert call args without a real IPC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serializeAsJSON: vi.fn(
    (_elements: unknown, _appState: unknown, _files: unknown, _type: string) =>
      '{"type":"excalidraw","version":2,"source":"local"}',
  ),
  serializeLibraryAsJSON: vi.fn(
    (_items: unknown) => '{"type":"excalidrawlib","version":2,"libraryItems":[]}',
  ),
  exportToBlob: vi.fn(async (_args: unknown) =>
    new Blob([new Uint8Array([0x50, 0x4e, 0x47, 0x21])], { type: "image/png" }),
  ),
  exportToSvg: vi.fn(async (_args: unknown) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-test", "excalidraw");
    return svg as unknown as SVGSVGElement;
  }),
  writeWorkspaceText: vi.fn(async (_path: string, _text: string) => {}),
  writeWorkspaceBinary: vi.fn(async (_path: string, _b64: string) => {}),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  serializeAsJSON: mocks.serializeAsJSON,
  serializeLibraryAsJSON: mocks.serializeLibraryAsJSON,
  exportToBlob: mocks.exportToBlob,
  exportToSvg: mocks.exportToSvg,
}));

vi.mock("@/lib/tauri-commands", () => ({
  writeWorkspaceText: mocks.writeWorkspaceText,
  writeWorkspaceBinary: mocks.writeWorkspaceBinary,
}));

import { saveExcalidrawFile } from "@/lib/excalidraw/saveScene";

const FAKE_DATA = {
  elements: [{ id: "e1", type: "rect" }] as ReadonlyArray<unknown>,
  appState: { theme: "dark" } as Record<string, unknown>,
  files: {} as Record<string, unknown>,
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveExcalidrawFile — extension routing (#352 / AC5)", () => {
  it(".excalidraw → serializeAsJSON + writeWorkspaceText (verbatim)", async () => {
    await saveExcalidrawFile("/ws/scene.excalidraw", FAKE_DATA);
    expect(mocks.serializeAsJSON).toHaveBeenCalledTimes(1);
    expect(mocks.serializeAsJSON).toHaveBeenCalledWith(
      FAKE_DATA.elements,
      FAKE_DATA.appState,
      FAKE_DATA.files,
      "local",
    );
    expect(mocks.writeWorkspaceText).toHaveBeenCalledTimes(1);
    const [path, text] = mocks.writeWorkspaceText.mock.calls[0];
    expect(path).toBe("/ws/scene.excalidraw");
    expect(text).toBe('{"type":"excalidraw","version":2,"source":"local"}');
    expect(mocks.writeWorkspaceBinary).not.toHaveBeenCalled();
  });

  it(".excalidrawlib → serializeLibraryAsJSON + writeWorkspaceText", async () => {
    await saveExcalidrawFile("/ws/icons.excalidrawlib", FAKE_DATA);
    expect(mocks.serializeLibraryAsJSON).toHaveBeenCalledTimes(1);
    expect(mocks.writeWorkspaceText).toHaveBeenCalledTimes(1);
    const [path, text] = mocks.writeWorkspaceText.mock.calls[0];
    expect(path).toBe("/ws/icons.excalidrawlib");
    expect(text).toBe('{"type":"excalidrawlib","version":2,"libraryItems":[]}');
    expect(mocks.serializeAsJSON).not.toHaveBeenCalled();
    expect(mocks.writeWorkspaceBinary).not.toHaveBeenCalled();
  });

  it(".excalidrawlib → serializeLibraryAsJSON receives caller-supplied libraryItems verbatim (#352 P0-1 regression)", async () => {
    // Bug-expert P0-1: useExcalidrawAutoSave previously read
    // `live.libraryItems ?? null` from the Excalidraw onChange snapshot
    // (which never carries libraryItems — they live on the separate
    // library API). The fall-through `data.libraryItems ?? [] ` then
    // wrote an empty array, silently wiping any existing user library.
    // After the fix, `data.libraryItems` is the single source of truth
    // sourced from `onLibraryChange`, and `serializeLibraryAsJSON` MUST
    // receive that value verbatim — no `appState.libraryItems` fallback,
    // no empty-array default behind the user's back.
    const items = [
      { id: "lib1", status: "published", elements: [{ id: "e1", type: "rect" }] },
      { id: "lib2", status: "unpublished", elements: [{ id: "e2", type: "ellipse" }] },
    ] as ReadonlyArray<unknown>;
    await saveExcalidrawFile("/ws/icons.excalidrawlib", {
      ...FAKE_DATA,
      libraryItems: items,
    });
    expect(mocks.serializeLibraryAsJSON).toHaveBeenCalledTimes(1);
    expect(mocks.serializeLibraryAsJSON).toHaveBeenCalledWith(items);
  });

  it(".excalidrawlib → does NOT fall back to appState.libraryItems (#352 P0-1 regression)", async () => {
    // The pre-fix fallback chain was `data.libraryItems ?? appState.libraryItems ?? []`.
    // That fallback is wrong: Excalidraw's appState does NOT carry
    // libraryItems on scene change — they live on the separate library
    // API and surface via onLibraryChange. Reading them from appState
    // produced silent destruction of the user's library on every save
    // (the value was always undefined → fell through to []). Lock the
    // single-source contract: when libraryItems is undefined on the
    // payload, the saved library is empty regardless of any
    // appState shenanigans the caller leaks in.
    await saveExcalidrawFile("/ws/icons.excalidrawlib", {
      ...FAKE_DATA,
      // Deliberately leak a libraryItems shape into appState — the
      // pre-fix code would have read it; the post-fix code MUST NOT.
      appState: { theme: "dark", libraryItems: [{ id: "leaked", status: "published" }] },
      // libraryItems explicitly omitted to exercise the undefined branch.
    });
    expect(mocks.serializeLibraryAsJSON).toHaveBeenCalledTimes(1);
    // Empty array (the new explicit default) — NOT the leaked appState value.
    expect(mocks.serializeLibraryAsJSON).toHaveBeenCalledWith([]);
  });

  it(".excalidraw.png → exportToBlob(image/png) WITH appState.exportEmbedScene=true + writeWorkspaceBinary", async () => {
    // Iter-18 (user-reported regression): the embed-scene flag MUST be
    // set on `appState`, NOT as a top-level option. Excalidraw's
    // `exportToBlob` reads the flag from `e.appState?.exportEmbedScene`
    // (verified in chunk-K2UTITRG.js); a top-level
    // `exportEmbedScene: true` is silently ignored, producing a PNG
    // with NO `tEXt` chunk. `loadFromBlob` then sees no embedded
    // scene and the file is non-roundtrippable. The fix merges the
    // flag into a fresh appState clone so the user's authored
    // appState.exportEmbedScene (whatever value) is preserved when
    // loaded but always set to true for our save path.
    await saveExcalidrawFile("/ws/diagram.excalidraw.png", FAKE_DATA);
    expect(mocks.exportToBlob).toHaveBeenCalledTimes(1);
    const args = mocks.exportToBlob.mock.calls[0][0] as Record<string, unknown>;
    expect(args.mimeType).toBe("image/png");
    expect(args.elements).toBe(FAKE_DATA.elements);
    expect(args.files).toBe(FAKE_DATA.files);
    // The headline iter-18 assertion: appState carries the flag.
    const passedAppState = args.appState as Record<string, unknown>;
    expect(passedAppState.exportEmbedScene).toBe(true);
    // Original appState fields preserved.
    expect(passedAppState.theme).toBe("dark");
    // The user's authored appState must NOT be mutated.
    expect(FAKE_DATA.appState.exportEmbedScene).toBeUndefined();

    expect(mocks.writeWorkspaceBinary).toHaveBeenCalledTimes(1);
    const [path, base64] = mocks.writeWorkspaceBinary.mock.calls[0];
    expect(path).toBe("/ws/diagram.excalidraw.png");
    // 4 bytes "PNG!" → "UE5HIQ==" in base64.
    expect(base64).toBe("UE5HIQ==");
    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
  });

  it(".excalidraw.svg → exportToSvg WITH appState.exportEmbedScene=true + writeWorkspaceBinary", async () => {
    // Iter-18: same root cause as the PNG path — `exportToSvg`
    // destructures `exportEmbedScene` from the appState arg, NOT a
    // top-level option (verified in chunk-K2UTITRG.js).
    await saveExcalidrawFile("/ws/diagram.excalidraw.svg", FAKE_DATA);
    expect(mocks.exportToSvg).toHaveBeenCalledTimes(1);
    const args = mocks.exportToSvg.mock.calls[0][0] as Record<string, unknown>;
    expect(args.elements).toBe(FAKE_DATA.elements);
    expect(args.files).toBe(FAKE_DATA.files);
    const passedAppState = args.appState as Record<string, unknown>;
    expect(passedAppState.exportEmbedScene).toBe(true);
    expect(passedAppState.theme).toBe("dark");
    expect(FAKE_DATA.appState.exportEmbedScene).toBeUndefined();

    expect(mocks.writeWorkspaceBinary).toHaveBeenCalledTimes(1);
    const [path, base64] = mocks.writeWorkspaceBinary.mock.calls[0];
    expect(path).toBe("/ws/diagram.excalidraw.svg");
    expect(typeof base64).toBe("string");
    expect(base64.length).toBeGreaterThan(0);
    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
  });

  it("uppercase extensions (e.g. .EXCALIDRAW) route the same as lowercase", async () => {
    await saveExcalidrawFile("/ws/SCENE.EXCALIDRAW", FAKE_DATA);
    expect(mocks.serializeAsJSON).toHaveBeenCalledTimes(1);
    expect(mocks.writeWorkspaceText).toHaveBeenCalledTimes(1);
  });

  it("unsupported extension throws", async () => {
    await expect(
      saveExcalidrawFile("/ws/x.txt", FAKE_DATA),
    ).rejects.toThrow(/unsupported extension/i);
    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
    expect(mocks.writeWorkspaceBinary).not.toHaveBeenCalled();
  });

  it("does NOT pretty-print JSON for .excalidraw saves", async () => {
    await saveExcalidrawFile("/ws/scene.excalidraw", FAKE_DATA);
    const [, text] = mocks.writeWorkspaceText.mock.calls[0];
    expect(String(text)).not.toContain("\n");
    expect(String(text)).not.toContain("  ");
  });
});
