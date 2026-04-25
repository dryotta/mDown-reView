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

const tfr = (content: string) => ({
  content,
  size_bytes: new TextEncoder().encode(content).length,
  line_count: content.split("\n").filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "").length,
});

describe("useFileContent", () => {
  it("calls readTextFile on mount and returns ready with content + size + line count", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue({
      content: "# Hello",
      size_bytes: 7,
      line_count: 1,
    });

    const { result } = renderHook(() => useFileContent("/path/file.md"));

    // Initially loading
    expect(result.current.status).toBe("loading");

    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledWith("/path/file.md");
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("# Hello");
    expect(result.current.sizeBytes).toBe(7);
    expect(result.current.lineCount).toBe(1);
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
      .mockResolvedValueOnce(tfr("original content"))
      .mockResolvedValueOnce(tfr("updated content"));

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
    vi.mocked(commands.readTextFile).mockResolvedValue(tfr("content"));

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
    vi.mocked(commands.readTextFile).mockResolvedValue(tfr("content"));

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
    let resolveFirst: (v: { content: string; size_bytes: number; line_count: number }) => void;
    const firstPromise = new Promise<{ content: string; size_bytes: number; line_count: number }>(
      (r) => { resolveFirst = r; }
    );
    vi.mocked(commands.readTextFile)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(tfr("file B content"));

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
    await act(async () => { resolveFirst!(tfr("file A content")); });

    // Should still show file B content
    expect(result.current.content).toBe("file B content");
  });

  it("shows loading when path changes after a reload (no stale content)", async () => {
    let resolveB: (v: { content: string; size_bytes: number; line_count: number }) => void;
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce(tfr("file A content"))
      .mockResolvedValueOnce(tfr("file A reloaded"))
      .mockReturnValueOnce(new Promise((r) => { resolveB = r; }));

    const { result, rerender } = renderHook(
      ({ path }) => useFileContent(path),
      { initialProps: { path: "/path/fileA.md" } }
    );

    // Let file A load
    await act(async () => {});
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("file A content");

    // Trigger file-changed event to bump reloadKey > 0
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/path/fileA.md", kind: "content" },
        })
      );
    });

    // Let reload complete
    await act(async () => {});
    expect(result.current.content).toBe("file A reloaded");

    // Now switch to file B — should show loading, NOT stale file A content
    rerender({ path: "/path/fileB.md" });

    expect(result.current.status).toBe("loading");
    expect(result.current.content).toBeUndefined();

    // Let file B resolve
    await act(async () => { resolveB!(tfr("file B content")); });
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("file B content");
  });

  it("does not show loading spinner on reload (keeps stale content)", async () => {
    let resolveSecond: (v: { content: string; size_bytes: number; line_count: number }) => void;
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce(tfr("original"))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

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
    await act(async () => { resolveSecond!(tfr("updated")); });
    expect(result.current.content).toBe("updated");
  });
});
