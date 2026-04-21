import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileContent } from "@/hooks/useFileContent";
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

describe("useFileContent", () => {
  it("calls readTextFile on mount and returns ready with content", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue("# Hello");

    const { result } = renderHook(() => useFileContent("/path/file.md"));

    // Initially loading
    expect(result.current.status).toBe("loading");

    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledWith("/path/file.md");
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("# Hello");
  });

  it("returns binary status when readTextFile rejects with binary_file", async () => {
    vi.mocked(commands.readTextFile).mockRejectedValue("binary_file: /path/file.bin");

    const { result } = renderHook(() => useFileContent("/path/file.bin"));

    await act(async () => {});

    expect(result.current.status).toBe("binary");
  });

  it("returns too_large status when readTextFile rejects with file_too_large", async () => {
    vi.mocked(commands.readTextFile).mockRejectedValue("file_too_large: /path/huge.md");

    const { result } = renderHook(() => useFileContent("/path/huge.md"));

    await act(async () => {});

    expect(result.current.status).toBe("too_large");
  });

  it("returns error status with message for unknown errors", async () => {
    vi.mocked(commands.readTextFile).mockRejectedValue("something else");

    const { result } = renderHook(() => useFileContent("/path/file.md"));

    await act(async () => {});

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("something else");
  });

  it("returns image status for image files without calling readTextFile", async () => {
    const { result } = renderHook(() => useFileContent("/path/photo.png"));

    await act(async () => {});

    expect(result.current.status).toBe("image");
    expect(commands.readTextFile).not.toHaveBeenCalled();
  });

  it("reloads content when mdownreview:file-changed event fires with kind=content", async () => {
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce("original content")
      .mockResolvedValueOnce("updated content");

    const { result } = renderHook(() => useFileContent("/path/file.md"));

    await act(async () => {});
    expect(result.current.content).toBe("original content");

    // Simulate file change event
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/path/file.md", kind: "content" },
        })
      );
    });

    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(2);
    expect(result.current.content).toBe("updated content");
  });

  it("does not reload on file-changed event with kind=review", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue("content");

    renderHook(() => useFileContent("/path/file.md"));

    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/path/file.md", kind: "review" },
        })
      );
    });

    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);
  });

  it("does not reload on file-changed event for a different path", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue("content");

    renderHook(() => useFileContent("/path/file.md"));

    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/other/file.md", kind: "content" },
        })
      );
    });

    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);
  });

  it("ignores stale response when path changes rapidly (cancellation)", async () => {
    let resolveFirst: (v: string) => void;
    const firstPromise = new Promise<string>((r) => { resolveFirst = r; });
    vi.mocked(commands.readTextFile)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce("file B content");

    const { result, rerender } = renderHook(
      ({ path }) => useFileContent(path),
      { initialProps: { path: "/path/fileA.md" } }
    );

    // Switch to file B before file A resolves
    rerender({ path: "/path/fileB.md" });

    // Let file B resolve first
    await act(async () => {});
    expect(result.current.content).toBe("file B content");

    // Now resolve file A (should be ignored due to cancellation)
    await act(async () => { resolveFirst!("file A content"); });

    // Should still show file B content
    expect(result.current.content).toBe("file B content");
  });

  it("does not show loading spinner on reload (keeps stale content)", async () => {
    let resolveSecond: (v: string) => void;
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce("original")
      .mockReturnValueOnce(new Promise<string>((r) => { resolveSecond = r; }));

    const { result } = renderHook(() => useFileContent("/path/file.md"));

    await act(async () => {});
    expect(result.current.content).toBe("original");

    // Trigger reload
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/path/file.md", kind: "content" },
        })
      );
    });

    // While reloading, should NOT show loading — keeps stale content
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("original");

    // Complete reload
    await act(async () => { resolveSecond!("updated"); });
    expect(result.current.content).toBe("updated");
  });
});
