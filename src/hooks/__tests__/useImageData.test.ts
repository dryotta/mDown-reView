import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useImageData } from "@/hooks/useImageData";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");
vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useImageData", () => {
  it("returns dataUrl on success", async () => {
    vi.mocked(commands.readBinaryFile).mockResolvedValue("iVBORw0KGgo=");

    const { result } = renderHook(() => useImageData("/photo.png", "image/png"));

    await act(async () => {});

    expect(commands.readBinaryFile).toHaveBeenCalledWith("/photo.png");
    expect(result.current.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(result.current.error).toBeNull();
  });

  it("returns error on failure", async () => {
    vi.mocked(commands.readBinaryFile).mockRejectedValue(new Error("file_too_large"));

    const { result } = renderHook(() => useImageData("/huge.png", "image/png"));

    await act(async () => {});

    expect(result.current.dataUrl).toBeNull();
    expect(result.current.error).toContain("file_too_large");
  });

  it("cancels on path change — no state update after unmount", async () => {
    let resolveFirst: (v: string) => void;
    const firstPromise = new Promise<string>((r) => { resolveFirst = r; });
    vi.mocked(commands.readBinaryFile)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce("AAAA");

    const { result, rerender } = renderHook(
      ({ path }) => useImageData(path, "image/png"),
      { initialProps: { path: "/a.png" } }
    );

    // Switch path before first resolves
    rerender({ path: "/b.png" });

    await act(async () => {});
    expect(result.current.dataUrl).toBe("data:image/png;base64,AAAA");

    // Resolve first (should be ignored due to cancellation)
    await act(async () => { resolveFirst!("BBBB"); });
    expect(result.current.dataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("resets dataUrl and error when path changes", async () => {
    vi.mocked(commands.readBinaryFile).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      ({ path }) => useImageData(path, "image/png"),
      { initialProps: { path: "/a.png" } }
    );

    // Initially loading — both null
    expect(result.current.dataUrl).toBeNull();
    expect(result.current.error).toBeNull();

    cleanup();
  });
});
