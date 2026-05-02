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

  it(".excalidraw.png → exportToBlob(image/png, embedScene) + writeWorkspaceBinary", async () => {
    await saveExcalidrawFile("/ws/diagram.excalidraw.png", FAKE_DATA);
    expect(mocks.exportToBlob).toHaveBeenCalledTimes(1);
    const args = mocks.exportToBlob.mock.calls[0][0] as Record<string, unknown>;
    expect(args.mimeType).toBe("image/png");
    expect(args.exportEmbedScene).toBe(true);
    expect(args.elements).toBe(FAKE_DATA.elements);
    expect(args.appState).toBe(FAKE_DATA.appState);
    expect(args.files).toBe(FAKE_DATA.files);

    expect(mocks.writeWorkspaceBinary).toHaveBeenCalledTimes(1);
    const [path, base64] = mocks.writeWorkspaceBinary.mock.calls[0];
    expect(path).toBe("/ws/diagram.excalidraw.png");
    // 4 bytes "PNG!" → "UE5HIQ==" in base64.
    expect(base64).toBe("UE5HIQ==");
    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
  });

  it(".excalidraw.svg → exportToSvg(embedScene) + writeWorkspaceBinary", async () => {
    await saveExcalidrawFile("/ws/diagram.excalidraw.svg", FAKE_DATA);
    expect(mocks.exportToSvg).toHaveBeenCalledTimes(1);
    const args = mocks.exportToSvg.mock.calls[0][0] as Record<string, unknown>;
    expect(args.exportEmbedScene).toBe(true);
    expect(args.elements).toBe(FAKE_DATA.elements);
    expect(args.appState).toBe(FAKE_DATA.appState);
    expect(args.files).toBe(FAKE_DATA.files);

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
