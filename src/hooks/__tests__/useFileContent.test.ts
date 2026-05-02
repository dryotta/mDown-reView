import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileContent } from "@/hooks/useFileContent";
import * as commands from "@/lib/tauri-commands";
import { useStore } from "@/store";

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
  // bindings.ts emits `mtime_ms: number | null` (required, not optional —
  // the IPC always supplies a value, `null` when the FS doesn't expose
  // it). The hand-written tauri-commands.ts had it as optional; iter 2
  // of #263 converged on the bindings shape.
  mtime_ms: null,
});

describe("useFileContent", () => {
  it("calls readTextFile on mount and returns ready with content + size + line count", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue({
      content: "# Hello",
      size_bytes: 7,
      line_count: 1,
      mtime_ms: 1234567890,
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
    // Group D: file-meta cache must include fileMtime forwarded from Rust.
    const meta = useStore.getState().fileMetaByPath["/path/file.md"];
    expect(meta?.fileMtime).toBe(1234567890);
    expect(meta?.sizeBytes).toBe(7);
    expect(meta?.lineCount).toBe(1);
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

  // Issue #352 / AC7 — when a content event arrives for a file open in
  // Excalidraw editor mode AND the tab is dirty, hold off the reload and
  // surface a banner via `setExternalChangePending`.
  it("does NOT reload when path is in Excalidraw editor mode and dirty (#352)", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue(tfr("scene"));
    useStore.setState({
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
      excalidrawDirtyByTab: { "/ws/a.excalidraw": true },
      externalChangePendingByTab: {},
    });

    renderHook(() => useFileContent("/ws/a.excalidraw"));
    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/ws/a.excalidraw", kind: "content" },
        }),
      );
    });
    await act(async () => {});

    // Reload was NOT triggered.
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);
    // Pending banner state was set.
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBe(true);
  });

  it("DOES reload when Excalidraw editor mode but tab is clean (#352)", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue(tfr("scene"));
    useStore.setState({
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
      excalidrawDirtyByTab: {},
      externalChangePendingByTab: {},
    });

    renderHook(() => useFileContent("/ws/a.excalidraw"));
    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/ws/a.excalidraw", kind: "content" },
        }),
      );
    });
    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledTimes(2);
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  it("DOES reload non-editor Excalidraw paths (e.g. visual mode) even when dirty (#352)", async () => {
    vi.mocked(commands.readTextFile).mockResolvedValue(tfr("scene"));
    useStore.setState({
      viewModeByTab: { "/ws/a.excalidraw": "visual" },
      // Dirty alone shouldn't gate — a Visual-mode tab can't have dirty
      // edits per the slice's mode-switch clearing, but this guards
      // against the gate triggering on the wrong condition.
      excalidrawDirtyByTab: { "/ws/a.excalidraw": true },
      externalChangePendingByTab: {},
    });

    renderHook(() => useFileContent("/ws/a.excalidraw"));
    await act(async () => {});
    expect(commands.readTextFile).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/ws/a.excalidraw", kind: "content" },
        }),
      );
    });
    await act(async () => {});

    expect(commands.readTextFile).toHaveBeenCalledTimes(2);
  });

  it("ignores stale response when path changes rapidly (cancellation)", async () => {
    let resolveFirst: (v: {
      content: string;
      size_bytes: number;
      line_count: number;
      mtime_ms: number | null;
    }) => void;
    const firstPromise = new Promise<{
      content: string;
      size_bytes: number;
      line_count: number;
      mtime_ms: number | null;
    }>((r) => {
      resolveFirst = r;
    });
    vi.mocked(commands.readTextFile)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(tfr("file B content"));

    const { result, rerender } = renderHook(({ path }) => useFileContent(path), {
      initialProps: { path: "/path/fileA.md" },
    });

    // Switch to file B before file A resolves
    rerender({ path: "/path/fileB.md" });

    // Let file B resolve first
    await act(async () => {});
    expect(result.current.content).toBe("file B content");

    // Now resolve file A (should be ignored due to cancellation)
    await act(async () => {
      resolveFirst!(tfr("file A content"));
    });

    // Should still show file B content
    expect(result.current.content).toBe("file B content");
  });

  it("shows loading when path changes after a reload (no stale content)", async () => {
    let resolveB: (v: {
      content: string;
      size_bytes: number;
      line_count: number;
      mtime_ms: number | null;
    }) => void;
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce(tfr("file A content"))
      .mockResolvedValueOnce(tfr("file A reloaded"))
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveB = r;
        })
      );

    const { result, rerender } = renderHook(({ path }) => useFileContent(path), {
      initialProps: { path: "/path/fileA.md" },
    });

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
    await act(async () => {
      resolveB!(tfr("file B content"));
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.content).toBe("file B content");
  });

  it("does not show loading spinner on reload (keeps stale content)", async () => {
    let resolveSecond: (v: {
      content: string;
      size_bytes: number;
      line_count: number;
      mtime_ms: number | null;
    }) => void;
    vi.mocked(commands.readTextFile)
      .mockResolvedValueOnce(tfr("original"))
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveSecond = r;
        })
      );

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
    await act(async () => {
      resolveSecond!(tfr("updated"));
    });
    expect(result.current.content).toBe("updated");
  });

  it("writes fileMtime + sizeBytes to FileMeta on too-large path", async () => {
    // Fix 4 (issue #96): the binary / too-large path must mirror the
    // text-success path and propagate sizeBytes + mtime to the FileMeta
    // cache so StatusBar can render mtime for placeholder previews too.
    vi.mocked(commands.readTextFile).mockRejectedValue("file_too_large: /path/huge.bin");
    vi.mocked(commands.statFile).mockResolvedValue({
      size_bytes: 99_999_999,
      mtime_ms: 1_700_000_000_000,
    });

    const { result } = renderHook(() => useFileContent("/path/huge.bin"));
    await act(async () => {});
    // Let the follow-up statFile().then chain settle.
    await act(async () => {});

    expect(result.current.status).toBe("too_large");
    expect(result.current.sizeBytes).toBe(99_999_999);
    expect(result.current.mtimeMs).toBe(1_700_000_000_000);

    const meta = useStore.getState().fileMetaByPath["/path/huge.bin"];
    expect(meta?.fileMtime).toBe(1_700_000_000_000);
    expect(meta?.sizeBytes).toBe(99_999_999);
    // lineCount is intentionally NOT set on the too-large/binary path —
    // there is no decoded text to count lines on.
    expect(meta?.lineCount).toBeUndefined();
  });

  it("writes fileMtime + sizeBytes to FileMeta on binary path", async () => {
    vi.mocked(commands.readTextFile).mockRejectedValue("binary_file: /path/img.bin");
    vi.mocked(commands.statFile).mockResolvedValue({
      size_bytes: 4096,
      mtime_ms: 1_700_000_000_500,
    });

    const { result } = renderHook(() => useFileContent("/path/img.bin"));
    await act(async () => {});
    await act(async () => {});

    expect(result.current.status).toBe("binary");
    const meta = useStore.getState().fileMetaByPath["/path/img.bin"];
    expect(meta?.fileMtime).toBe(1_700_000_000_500);
    expect(meta?.sizeBytes).toBe(4096);
  });

  // Issue #352 / iter-5 BLOCKER (test-expert + assessor) — the iter-4
  // useFileContent short-circuit for `.excalidraw.png` / `.excalidraw.svg`
  // is the entire mechanism that makes AC1 work for binary variants.
  // Until iter-5 it had ZERO test coverage. These tests lock down the
  // contract:
  //   (a) `.excalidraw.png` resolves to status='ready' (NOT 'binary').
  //   (b) content is the empty-string sentinel (consumers respect it).
  //   (c) sizeBytes/mtime come from `statFile`, never `readTextFile`.
  //   (d) `setFileMeta` is called with the stat'd values.
  //   (e) `statFile` rejection still resolves to status='ready' with
  //       sizeBytes:0 (don't degrade to 'binary' or 'error').
  //   (f) `readTextFile` is NOT called for these paths.
  describe("Excalidraw binary short-circuit (#352 / iter-5)", () => {
    it("treats .excalidraw.png as status='ready' with empty content + stat metadata", async () => {
      vi.mocked(commands.statFile).mockResolvedValue({
        size_bytes: 4096,
        mtime_ms: 1700000000000,
      });

      const { result } = renderHook(() => useFileContent("/ws/diagram.excalidraw.png"));
      await act(async () => {});

      expect(commands.readTextFile).not.toHaveBeenCalled();
      expect(commands.statFile).toHaveBeenCalledWith("/ws/diagram.excalidraw.png");
      expect(result.current.status).toBe("ready");
      expect(result.current.content).toBe("");
      expect(result.current.sizeBytes).toBe(4096);
      expect(result.current.lineCount).toBe(0);
      expect(result.current.mtimeMs).toBe(1700000000000);
      const meta = useStore.getState().fileMetaByPath["/ws/diagram.excalidraw.png"];
      expect(meta?.sizeBytes).toBe(4096);
      expect(meta?.lineCount).toBe(0);
      expect(meta?.fileMtime).toBe(1700000000000);
    });

    it("treats .excalidraw.svg the same way", async () => {
      vi.mocked(commands.statFile).mockResolvedValue({
        size_bytes: 1024,
        mtime_ms: null,
      });

      const { result } = renderHook(() => useFileContent("/ws/icons.excalidraw.svg"));
      await act(async () => {});

      expect(commands.readTextFile).not.toHaveBeenCalled();
      expect(result.current.status).toBe("ready");
      expect(result.current.content).toBe("");
      expect(result.current.mtimeMs).toBeNull();
    });

    it("statFile rejection still resolves to status='ready' with sizeBytes=0", async () => {
      vi.mocked(commands.statFile).mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useFileContent("/ws/x.excalidraw.png"));
      await act(async () => {});

      expect(result.current.status).toBe("ready");
      expect(result.current.content).toBe("");
      expect(result.current.sizeBytes).toBe(0);
    });

    it("does NOT short-circuit canonical .excalidraw (delegates to readTextFile)", async () => {
      vi.mocked(commands.readTextFile).mockResolvedValue(tfr('{"type":"excalidraw"}'));

      renderHook(() => useFileContent("/ws/scene.excalidraw"));
      await act(async () => {});

      expect(commands.readTextFile).toHaveBeenCalledWith("/ws/scene.excalidraw");
      expect(commands.statFile).not.toHaveBeenCalled();
    });

    it("path change from a binary excalidraw to a regular file invokes readTextFile (cancellation safety)", async () => {
      vi.mocked(commands.statFile).mockResolvedValue({
        size_bytes: 100,
        mtime_ms: null,
      });
      vi.mocked(commands.readTextFile).mockResolvedValue(tfr("# md"));

      const { rerender } = renderHook(({ path }) => useFileContent(path), {
        initialProps: { path: "/ws/a.excalidraw.png" },
      });
      await act(async () => {});

      rerender({ path: "/ws/b.md" });
      await act(async () => {});

      expect(commands.readTextFile).toHaveBeenCalledWith("/ws/b.md");
    });
  });


  // reloads (frequent under AI-agent regenerate-by-save) must NOT trigger a
  // re-render of consumers. Verified via reference identity on the returned
  // state object — React 19 bails the re-render via `Object.is(prev, prev)`
  // when a functional updater returns `prev`.
  describe("byte-identical reload bailout", () => {
    const dispatchReload = (path: string) =>
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path, kind: "content" },
        })
      );

    it("preserves state reference identity on byte-identical reload", async () => {
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "stable",
        size_bytes: 6,
        line_count: 1,
        mtime_ms: 1,
      });

      const { result } = renderHook(() => useFileContent("/p/f.md"));
      await act(async () => {});
      const before = result.current;
      expect(before.content).toBe("stable");

      // Reload returns identical bytes — even with a different mtime the
      // setState must bail (mtime is not part of the FileContent shape).
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "stable",
        size_bytes: 6,
        line_count: 1,
        mtime_ms: 2,
      });
      await act(async () => {
        dispatchReload("/p/f.md");
      });
      await act(async () => {});

      const after = result.current;
      expect(after).toBe(before); // reference identity — React bailed
      expect(after.content).toBe("stable");
    });

    it("creates a new state reference when content changes", async () => {
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "v1",
        size_bytes: 2,
        line_count: 1,
        mtime_ms: 1,
      });
      const { result } = renderHook(() => useFileContent("/p/f.md"));
      await act(async () => {});
      const before = result.current;

      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "v2",
        size_bytes: 2,
        line_count: 1,
        mtime_ms: 2,
      });
      await act(async () => {
        dispatchReload("/p/f.md");
      });
      await act(async () => {});

      expect(result.current).not.toBe(before);
      expect(result.current.content).toBe("v2");
    });

    it("creates a new state reference when sizeBytes changes (even if content string ref differs)", async () => {
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "abc",
        size_bytes: 3,
        line_count: 1,
        mtime_ms: 1,
      });
      const { result } = renderHook(() => useFileContent("/p/f.md"));
      await act(async () => {});
      const before = result.current;

      // Same content string but different reported size_bytes: defends
      // the sizeBytes branch of the equality check.
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "abc",
        size_bytes: 99,
        line_count: 1,
        mtime_ms: 2,
      });
      await act(async () => {
        dispatchReload("/p/f.md");
      });
      await act(async () => {});

      expect(result.current).not.toBe(before);
      expect(result.current.sizeBytes).toBe(99);
    });

    it("creates a new state reference when lineCount changes", async () => {
      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "abc",
        size_bytes: 3,
        line_count: 1,
        mtime_ms: 1,
      });
      const { result } = renderHook(() => useFileContent("/p/f.md"));
      await act(async () => {});
      const before = result.current;

      vi.mocked(commands.readTextFile).mockResolvedValue({
        content: "abc",
        size_bytes: 3,
        line_count: 7,
        mtime_ms: 2,
      });
      await act(async () => {
        dispatchReload("/p/f.md");
      });
      await act(async () => {});

      expect(result.current).not.toBe(before);
      expect(result.current.lineCount).toBe(7);
    });
  });
});
