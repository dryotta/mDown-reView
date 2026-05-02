import { describe, it, expect, vi, beforeEach } from "vitest";

const readBinaryFileMock = vi.fn<(path: string) => Promise<string>>();
const loadFromBlobMock = vi.fn();

vi.mock("@/lib/tauri-commands", () => ({
  readBinaryFile: (path: string) => readBinaryFileMock(path),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  loadFromBlob: (...args: unknown[]) => loadFromBlobMock(...args),
}));

import { extractScene } from "../extractScene";

const FAKE_BASE64 = btoa("\x89PNG\r\n\x1a\nfake-bytes");

beforeEach(() => {
  readBinaryFileMock.mockReset();
  loadFromBlobMock.mockReset();
  readBinaryFileMock.mockResolvedValue(FAKE_BASE64);
});

describe("extractScene", () => {
  it("returns the scene on the happy path", async () => {
    loadFromBlobMock.mockResolvedValue({
      elements: [{ id: "el-1" }],
      appState: { theme: "light" },
      files: { f1: {} },
    });

    const scene = await extractScene("/ws/diagram.excalidraw.png");

    expect(scene.elements).toEqual([{ id: "el-1" }]);
    expect(scene.appState).toEqual({ theme: "light" });
    expect(scene.files).toEqual({ f1: {} });
    expect(readBinaryFileMock).toHaveBeenCalledWith("/ws/diagram.excalidraw.png");
  });

  it("derives image/png mime for .png paths", async () => {
    loadFromBlobMock.mockResolvedValue({ elements: [], appState: {}, files: {} });

    await extractScene("/ws/foo.excalidraw.PNG");

    expect(loadFromBlobMock).toHaveBeenCalledTimes(1);
    const [blobArg] = loadFromBlobMock.mock.calls[0] as [Blob, unknown, unknown];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("image/png");
  });

  it("derives image/svg+xml mime for .svg paths", async () => {
    loadFromBlobMock.mockResolvedValue({ elements: [], appState: {}, files: {} });

    await extractScene("/ws/foo.excalidraw.svg");

    const [blobArg] = loadFromBlobMock.mock.calls[0] as [Blob, unknown, unknown];
    expect(blobArg.type).toBe("image/svg+xml");
  });

  it("falls back to octet-stream for unknown extensions", async () => {
    loadFromBlobMock.mockResolvedValue({ elements: [], appState: {}, files: {} });

    await extractScene("/ws/strange.bin");

    const [blobArg] = loadFromBlobMock.mock.calls[0] as [Blob, unknown, unknown];
    expect(blobArg.type).toBe("application/octet-stream");
  });

  it("propagates errors from loadFromBlob", async () => {
    loadFromBlobMock.mockRejectedValue(new Error("no scene chunk"));

    await expect(extractScene("/ws/foo.excalidraw.png")).rejects.toThrow(/no scene chunk/);
  });

  it("normalises missing fields to empty defaults", async () => {
    loadFromBlobMock.mockResolvedValue({});

    const scene = await extractScene("/ws/foo.excalidraw.png");

    expect(scene.elements).toEqual([]);
    expect(scene.appState).toEqual({});
    expect(scene.files).toEqual({});
  });
});
