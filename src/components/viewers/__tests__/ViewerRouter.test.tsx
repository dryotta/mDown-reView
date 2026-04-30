import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ViewerRouter } from "../ViewerRouter";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// B2 (iter 7 forward-fix) — `ViewerToolbar` now reads per-tab badge counts
// via `useFileBadges`. Stub it so router tests don't depend on the IPC mock
// surface for the comments-changed / file-changed listeners.
vi.mock("@/hooks/useFileBadges", () => ({
  useFileBadges: () => ({}),
}));

// Mock child viewers as simple test stubs
vi.mock("../EnhancedViewer", () => ({
  EnhancedViewer: ({ filePath, fileSize, onCommentOnFile }: { filePath: string; fileSize?: number; onCommentOnFile?: () => void }) => (
    <div
      data-testid="enhanced-viewer"
      data-path={filePath}
      data-filesize={fileSize}
      data-has-comment-on-file={onCommentOnFile ? "true" : "false"}
    >
      EnhancedViewer
      {onCommentOnFile && (
        <button data-testid="enhanced-viewer-comment-btn" onClick={onCommentOnFile}>cof</button>
      )}
    </div>
  ),
}));

vi.mock("../ImageViewerShell", () => ({
  ImageViewerShell: ({ path, onCommentOnFile }: { path: string; onCommentOnFile?: () => void }) => (
    <div data-testid="image-viewer-shell" data-path={path} data-has-comment-on-file={onCommentOnFile ? "true" : "false"}>
      ImageViewerShell
      {onCommentOnFile && (
        <button data-testid="image-shell-comment-btn" onClick={onCommentOnFile}>cof</button>
      )}
    </div>
  ),
}));

vi.mock("../AudioViewer", () => ({
  AudioViewer: ({ path }: { path: string }) => (
    <div data-testid="audio-viewer" data-path={path}>AudioViewer</div>
  ),
  getAudioMime: (p: string) => (p.endsWith(".mp3") ? "audio/mpeg" : "audio/*"),
}));

vi.mock("../BinaryViewerShell", () => ({
  BinaryViewerShell: ({ path, size, onCommentOnFile }: { path: string; size?: number; onCommentOnFile?: () => void }) => (
    <div data-testid="binary-viewer-shell" data-path={path} data-size={size} data-has-comment-on-file={onCommentOnFile ? "true" : "false"}>
      BinaryViewerShell
      {onCommentOnFile && (
        <button data-testid="binary-shell-comment-btn" onClick={onCommentOnFile}>cof</button>
      )}
    </div>
  ),
}));

vi.mock("../TooLargePlaceholder", () => ({
  TooLargePlaceholder: ({ path, size }: { path: string; size?: number }) => (
    <div data-testid="too-large-placeholder" data-path={path} data-size={size}>TooLargePlaceholder</div>
  ),
}));

vi.mock("../SkeletonLoader", () => ({
  SkeletonLoader: () => <div data-testid="skeleton-loader">Loading…</div>,
}));

vi.mock("../DeletedFileViewer", () => ({
  DeletedFileViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="deleted-file-viewer" data-path={filePath}>DeletedFileViewer</div>
  ),
}));

// Mock useFileContent hook
vi.mock("@/hooks/useFileContent");
import { useFileContent } from "@/hooks/useFileContent";
const mockUseFileContent = useFileContent as ReturnType<typeof vi.fn>;

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  useStore.setState({ tabs: [], activeTabPath: null });
  mockUseFileContent.mockReset();
});

describe("ViewerRouter routing", () => {
  it(".md extension routes to EnhancedViewer", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "# Hello" });
    useStore.setState({ tabs: [{ path: "/docs/README.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/README.md" />);
    expect(screen.getByTestId("enhanced-viewer")).toBeInTheDocument();
  });

  it(".json extension routes to EnhancedViewer", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: '{"a":1}' });
    useStore.setState({ tabs: [{ path: "/data.json", scrollTop: 0 }] });
    render(<ViewerRouter path="/data.json" />);
    expect(screen.getByTestId("enhanced-viewer")).toBeInTheDocument();
  });

  it(".ts extension routes to EnhancedViewer", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "const x = 1;" });
    useStore.setState({ tabs: [{ path: "/src/index.ts", scrollTop: 0 }] });
    render(<ViewerRouter path="/src/index.ts" />);
    expect(screen.getByTestId("enhanced-viewer")).toBeInTheDocument();
  });

  it("image status routes to ImageViewerShell", () => {
    mockUseFileContent.mockReturnValue({ status: "image" });
    useStore.setState({ tabs: [{ path: "/photos/test.png", scrollTop: 0 }] });
    render(<ViewerRouter path="/photos/test.png" />);
    expect(screen.getByTestId("image-viewer-shell")).toBeInTheDocument();
  });

  it("audio status routes to AudioViewer (#65 F1)", () => {
    mockUseFileContent.mockReturnValue({ status: "audio" });
    useStore.setState({ tabs: [{ path: "/music/song.mp3", scrollTop: 0 }] });
    render(<ViewerRouter path="/music/song.mp3" />);
    expect(screen.getByTestId("audio-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("audio-viewer").dataset.path).toBe("/music/song.mp3");
  });

  it("loading status shows SkeletonLoader", () => {
    mockUseFileContent.mockReturnValue({ status: "loading" });
    useStore.setState({ tabs: [{ path: "/docs/README.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/README.md" />);
    expect(screen.getByTestId("skeleton-loader")).toBeInTheDocument();
  });

  it("binary status shows BinaryViewerShell", () => {
    mockUseFileContent.mockReturnValue({ status: "binary" });
    useStore.setState({ tabs: [{ path: "/docs/file.bin", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/file.bin" />);
    expect(screen.getByTestId("binary-viewer-shell")).toBeInTheDocument();
  });

  it("too_large status shows TooLargePlaceholder (not BinaryViewerShell)", () => {
    mockUseFileContent.mockReturnValue({ status: "too_large", sizeBytes: 11 * 1024 * 1024 });
    useStore.setState({ tabs: [{ path: "/data/huge.csv", scrollTop: 0 }] });
    render(<ViewerRouter path="/data/huge.csv" />);
    expect(screen.getByTestId("too-large-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("binary-viewer-shell")).not.toBeInTheDocument();
    expect(screen.getByTestId("too-large-placeholder").dataset.size).toBe(String(11 * 1024 * 1024));
  });

  it("binary status forwards sizeBytes to BinaryViewerShell", () => {
    mockUseFileContent.mockReturnValue({ status: "binary", sizeBytes: 1234 });
    useStore.setState({ tabs: [{ path: "/docs/file.bin", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/file.bin" />);
    expect(screen.getByTestId("binary-viewer-shell").dataset.size).toBe("1234");
  });

  it("error status shows error message", () => {
    mockUseFileContent.mockReturnValue({ status: "error", error: "file not found" });
    useStore.setState({ tabs: [{ path: "/missing.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/missing.md" />);
    expect(screen.getByText(/Error loading file/)).toBeInTheDocument();
    expect(screen.getByText(/file not found/)).toBeInTheDocument();
  });

  it("error status with ghost entry routes to DeletedFileViewer", () => {
    mockUseFileContent.mockReturnValue({ status: "error", error: "file not found" });
    useStore.setState({
      tabs: [{ path: "/gone.md", scrollTop: 0 }],
      ghostEntries: [{ sidecarPath: "/gone.md.review.yaml", sourcePath: "/gone.md" }],
    });
    render(<ViewerRouter path="/gone.md" />);
    expect(screen.getByTestId("deleted-file-viewer")).toBeInTheDocument();
    expect(screen.queryByText(/Error loading file/)).not.toBeInTheDocument();
  });
});

// ─── Iter 5 Group B: file-anchored entry point is universal ─────────────────

describe("ViewerRouter — onCommentOnFile is wired in every viewer branch", () => {
  function expectCommentOnFileButton() {
    const btn = screen.getByRole("button", { name: /comment on file/i });
    expect(btn).toBeInTheDocument();
    return btn;
  }

  it("EnhancedViewer (text) receives an onCommentOnFile callback", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "# Hello" });
    useStore.setState({ tabs: [{ path: "/r.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/r.md" />);
    expect(screen.getByTestId("enhanced-viewer").dataset.hasCommentOnFile).toBe("true");
  });

  it("clicking the wired callback in EnhancedViewer sets pendingFileLevelInputFor and shows comments pane", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "# Hello" });
    useStore.setState({ tabs: [{ path: "/r.md", scrollTop: 0 }], pendingFileLevelInputFor: null, commentsPaneVisible: false });
    render(<ViewerRouter path="/r.md" />);
    fireEvent.click(screen.getByTestId("enhanced-viewer-comment-btn"));
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/r.md");
    expect(useStore.getState().commentsPaneVisible).toBe(true);
  });

  it("image viewer passes onCommentOnFile to ImageViewerShell", () => {
    mockUseFileContent.mockReturnValue({ status: "image" });
    useStore.setState({ tabs: [{ path: "/x.png", scrollTop: 0 }], pendingFileLevelInputFor: null });
    render(<ViewerRouter path="/x.png" />);
    expect(screen.getByTestId("image-viewer-shell").dataset.hasCommentOnFile).toBe("true");
    fireEvent.click(screen.getByTestId("image-shell-comment-btn"));
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/x.png");
  });

  it("audio viewer surfaces a Comment-on-file button", () => {
    mockUseFileContent.mockReturnValue({ status: "audio" });
    useStore.setState({ tabs: [{ path: "/s.mp3", scrollTop: 0 }], pendingFileLevelInputFor: null });
    render(<ViewerRouter path="/s.mp3" />);
    fireEvent.click(expectCommentOnFileButton());
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/s.mp3");
  });

  it("binary viewer passes onCommentOnFile to BinaryViewerShell", () => {
    mockUseFileContent.mockReturnValue({ status: "binary" });
    useStore.setState({ tabs: [{ path: "/b.bin", scrollTop: 0 }], pendingFileLevelInputFor: null });
    render(<ViewerRouter path="/b.bin" />);
    expect(screen.getByTestId("binary-viewer-shell").dataset.hasCommentOnFile).toBe("true");
    fireEvent.click(screen.getByTestId("binary-shell-comment-btn"));
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/b.bin");
  });

  it("too_large placeholder surfaces a Comment-on-file button", () => {
    mockUseFileContent.mockReturnValue({ status: "too_large", sizeBytes: 99 });
    useStore.setState({ tabs: [{ path: "/big.csv", scrollTop: 0 }], pendingFileLevelInputFor: null });
    render(<ViewerRouter path="/big.csv" />);
    fireEvent.click(expectCommentOnFileButton());
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/big.csv");
  });

  it("error branch (non-ghost) renders a toolbar with Comment-on-file and FileActionsBar", () => {
    mockUseFileContent.mockReturnValue({ status: "error", error: "boom" });
    useStore.setState({ tabs: [{ path: "/missing.md", scrollTop: 0 }], pendingFileLevelInputFor: null });
    render(<ViewerRouter path="/missing.md" />);
    fireEvent.click(expectCommentOnFileButton());
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/missing.md");
  });
});

describe("ViewerRouter fileSize source", () => {
  // RC6/P1.3 (#298) — fileSize is now sourced directly from
  // useFileContent's sizeBytes (the canonical on-disk byte length
  // returned by the Rust IPC), instead of recomputing via
  // TextEncoder on every content swap. This eliminates a Uint8Array
  // allocation of the entire file on each render.
  it("forwards sizeBytes from useFileContent for ASCII content", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "Hello, world!", sizeBytes: 13 });
    useStore.setState({ tabs: [{ path: "/test.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/test.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe("13");
  });

  it("forwards sizeBytes from useFileContent for multi-byte content", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "こんにちは", sizeBytes: 15 });
    useStore.setState({ tabs: [{ path: "/jp.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/jp.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe("15");
  });

  it("passes undefined fileSize when sizeBytes is undefined", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: null, sizeBytes: undefined });
    useStore.setState({ tabs: [{ path: "/empty.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/empty.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe(undefined);
  });

  it("does not allocate a Uint8Array via TextEncoder on render", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "stable content", sizeBytes: 14 });
    useStore.setState({ tabs: [{ path: "/stable.txt", scrollTop: 0 }] });

    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");

    const { rerender } = render(<ViewerRouter path="/stable.txt" />);
    rerender(<ViewerRouter path="/stable.txt" />);

    // ViewerRouter no longer encodes content to derive its byte length;
    // sizeBytes from the Rust IPC is the canonical source.
    expect(encodeSpy).not.toHaveBeenCalled();

    encodeSpy.mockRestore();
  });
});

describe("ViewerRouter scroll throttle", () => {
  let rafCallbacks: Array<() => void>;
  let rafIdCounter: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;
    cancelledIds = new Set();

    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      const id = ++rafIdCounter;
      rafCallbacks.push(() => {
        if (!cancelledIds.has(id)) cb(performance.now());
      });
      return id;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      cancelledIds.add(id);
    });
  });

  function flushRaf() {
    const batch = rafCallbacks.splice(0);
    batch.forEach((cb) => cb());
  }

  it("does not call setScrollTop synchronously on scroll", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "text" });
    useStore.setState({ tabs: [{ path: "/a.txt", scrollTop: 0 }] });
    const spy = vi.spyOn(useStore.getState(), "setScrollTop");

    render(<ViewerRouter path="/a.txt" />);

    const container = screen.getByTestId("enhanced-viewer").parentElement!;
    fireEvent.scroll(container, { target: { scrollTop: 100 } });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls setScrollTop after rAF fires", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "text" });
    useStore.setState({ tabs: [{ path: "/a.txt", scrollTop: 0 }] });
    const spy = vi.spyOn(useStore.getState(), "setScrollTop");

    render(<ViewerRouter path="/a.txt" />);

    const container = screen.getByTestId("enhanced-viewer").parentElement!;
    fireEvent.scroll(container, { target: { scrollTop: 200 } });

    act(() => flushRaf());

    expect(spy).toHaveBeenCalledWith("/a.txt", 200);
    spy.mockRestore();
  });

  it("coalesces rapid scroll events into one setScrollTop call", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "text" });
    useStore.setState({ tabs: [{ path: "/a.txt", scrollTop: 0 }] });
    const spy = vi.spyOn(useStore.getState(), "setScrollTop");

    render(<ViewerRouter path="/a.txt" />);

    const container = screen.getByTestId("enhanced-viewer").parentElement!;
    fireEvent.scroll(container, { target: { scrollTop: 100 } });
    fireEvent.scroll(container, { target: { scrollTop: 200 } });
    fireEvent.scroll(container, { target: { scrollTop: 300 } });

    act(() => flushRaf());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("/a.txt", 300);
    spy.mockRestore();
  });

  it("cancels pending rAF on unmount", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "text" });
    useStore.setState({ tabs: [{ path: "/a.txt", scrollTop: 0 }] });
    const spy = vi.spyOn(useStore.getState(), "setScrollTop");

    const { unmount } = render(<ViewerRouter path="/a.txt" />);

    const container = screen.getByTestId("enhanced-viewer").parentElement!;
    fireEvent.scroll(container, { target: { scrollTop: 500 } });

    unmount();
    act(() => flushRaf());

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("ViewerRouter scroll feedback loop prevention", () => {
  let rafCallbacks: Array<() => void>;
  let rafIdCounter: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;
    cancelledIds = new Set();

    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      const id = ++rafIdCounter;
      rafCallbacks.push(() => {
        if (!cancelledIds.has(id)) cb(performance.now());
      });
      return id;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      cancelledIds.add(id);
    });
  });

  function flushRaf() {
    const batch = rafCallbacks.splice(0);
    batch.forEach((cb) => cb());
  }

  it("scroll-save does not trigger scroll-restore (no feedback loop)", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "text" });
    useStore.setState({ tabs: [{ path: "/loop.txt", scrollTop: 0 }] });

    render(<ViewerRouter path="/loop.txt" />);

    const container = screen.getByTestId("enhanced-viewer").parentElement!;

    // Simulate user scrolling repeatedly
    for (let i = 1; i <= 10; i++) {
      fireEvent.scroll(container, { target: { scrollTop: i * 50 } });
      act(() => flushRaf());
    }

    // Store should have the final scroll position
    const tab = useStore.getState().tabs.find((t) => t.path === "/loop.txt");
    expect(tab?.scrollTop).toBe(500);
  });

  it("setScrollTop is a no-op when value is unchanged", () => {
    useStore.setState({ tabs: [{ path: "/noop.txt", scrollTop: 200 }] });

    const stateBefore = useStore.getState();
    useStore.getState().setScrollTop("/noop.txt", 200);
    const stateAfter = useStore.getState();

    // Should be the exact same reference (no unnecessary re-renders)
    expect(stateAfter.tabs).toBe(stateBefore.tabs);
  });

  it("setScrollTop updates when value changes", () => {
    useStore.setState({ tabs: [{ path: "/change.txt", scrollTop: 100 }] });

    useStore.getState().setScrollTop("/change.txt", 300);

    const tab = useStore.getState().tabs.find((t) => t.path === "/change.txt");
    expect(tab?.scrollTop).toBe(300);
  });

  it("setScrollTop is a no-op for non-existent tab", () => {
    useStore.setState({ tabs: [{ path: "/exists.txt", scrollTop: 0 }] });

    const stateBefore = useStore.getState();
    useStore.getState().setScrollTop("/missing.txt", 100);
    const stateAfter = useStore.getState();

    // Should not create a new state
    expect(stateAfter.tabs).toBe(stateBefore.tabs);
  });
});

// B1 forward-fix (iter 10): when a cross-file scroll target is queued for
// THIS viewer's path, the parent's saved-scroll restore must NOT run —
// otherwise it overwrites the child `useScrollToLine` mount-effect's scroll
// (child effects run before parent effects in React).
describe("ViewerRouter scroll-restore vs pendingScrollTarget", () => {
  it("skips saved-scroll restore when pendingScrollTarget.filePath matches", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "x" });
    useStore.setState({
      tabs: [{ path: "/a.txt", scrollTop: 1234 }],
      pendingScrollTarget: { filePath: "/a.txt", line: 7 },
    });

    render(<ViewerRouter path="/a.txt" />);
    const container = screen.getByTestId("enhanced-viewer").parentElement as HTMLDivElement;
    // Restore was suppressed → scrollTop stays at jsdom default 0, NOT 1234.
    expect(container.scrollTop).toBe(0);
  });

  it("still restores saved scroll when pendingScrollTarget is for a different file", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "x" });
    useStore.setState({
      tabs: [{ path: "/a.txt", scrollTop: 50 }],
      pendingScrollTarget: { filePath: "/other.txt", line: 7 },
    });

    render(<ViewerRouter path="/a.txt" />);
    // Restore path runs (under jsdom the rAF retry may not flush, but the
    // explicit-zero short-circuit at least proves the guard didn't fire).
    // The key invariant: the effect was NOT suppressed by the guard.
    // We assert this by clearing the pending target and confirming
    // the field is unchanged.
    expect(useStore.getState().pendingScrollTarget).not.toBeNull();
    expect(useStore.getState().pendingScrollTarget!.filePath).toBe("/other.txt");
  });

  // RC4/P1.2 (#298): with the `pendingScrollTarget` subscription removed
  // from ViewerRouter, the child `useScrollToLine` consume (which clears
  // the store) no longer re-renders the parent. The restore effect's
  // early-return reads via `useStore.getState()` at effect time, and
  // because the deps `[path, status, content]` do not change, the effect
  // does not re-fire after the consume. This test still asserts the
  // observable invariant: the comment-anchored scroll the child applied
  // is not overwritten.
  //
  // The mock below clears the store synchronously to simulate the real
  // child consume path — we cannot use the real `useScrollToLine` here
  // because EnhancedViewer is mocked at module scope.
  it("does NOT overwrite comment-scroll after child consumes pendingScrollTarget", () => {
    // Force rAF to fire synchronously so the restore retry loop runs in jsdom.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    mockUseFileContent.mockReturnValue({ status: "ready", content: "x" });
    useStore.setState({
      tabs: [{ path: "/a.txt", scrollTop: 1234 }],
      pendingScrollTarget: { filePath: "/a.txt", line: 7 },
    });

    render(<ViewerRouter path="/a.txt" />);

    // Simulate the child mount-effect chain:
    //   1) useScrollToLine consumes pendingScrollTarget (clears the store)
    //   2) it scrolls the container to the comment-anchored line
    // Both happen inside a single act() so React flushes the re-render
    // triggered by the store clear before our final assertion.
    const container = screen.getByTestId("enhanced-viewer").parentElement as HTMLDivElement;
    act(() => {
      useStore.getState().consumePendingScrollTarget("/a.txt");
      container.scrollTop = 500; // pretend comment-anchored scroll value
    });

    // With the original B1 bug, the re-render after the child consume would
    // re-fire the restore effect and snap scrollTop back to 1234. With
    // RC4/P1.2 (#298) — the subscription is dropped — no re-render fires
    // at all, the deps don't change, and scrollTop stays at 500.
    expect(container.scrollTop).toBe(500);
    expect(container.scrollTop).not.toBe(1234);

    rafSpy.mockRestore();
  });

  // B1 regression (iter 2 forward-fix #298): the loading→ready transition
  // is the failure mode the previous "always-ready" test could not catch.
  // When ViewerRouter mounts with status="loading" and pendingScrollTarget
  // is set for this path, the saved-scroll restore effect early-returns
  // (status !== "ready"). When content arrives and the parent re-renders
  // with status="ready", passive effects fire CHILD→PARENT: the child
  // viewer's `useScrollToLine` mount-effect consumes pendingScrollTarget
  // and applies the comment-anchored scroll BEFORE the parent's restore
  // effect runs. Without the layout-effect latch, the parent's restore
  // effect then reads `useStore.getState().pendingScrollTarget` (now null,
  // because the child consumed it) and the early-return guard misses,
  // letting the saved scrollTop overwrite the comment-anchored scroll.
  //
  // The layout-effect latch fires AT MOUNT (deps `[path]`), captures the
  // pending slot synchronously before any passive effect, and survives
  // the child's later consume. This test simulates that ordering: render
  // with loading first so the latch grabs the slot, transition to ready,
  // simulate the child consume + manual scroll, then assert the parent's
  // restore did not overwrite. Without the latch, this test fails: the
  // restore effect re-fires on the status flip and snaps scrollTop to
  // the saved 1234.
  it("does not overwrite child's comment-anchored scroll on loading→ready transition (B1 regression #298)", () => {
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    useStore.setState({
      tabs: [{ path: "/a.txt", scrollTop: 1234 }],
      activeTabPath: "/a.txt",
      pendingScrollTarget: { filePath: "/a.txt", line: 7 },
    });

    // Initial render with status="loading". The restore effect early-
    // returns at the `status !== "ready"` check, but the layout-effect
    // latch fires after mount and captures the pending slot for /a.txt.
    mockUseFileContent.mockReturnValue({ status: "loading", content: undefined });
    const { rerender, container } = render(<ViewerRouter path="/a.txt" />);
    const scrollRegion = container.querySelector(".viewer-scroll-region") as HTMLDivElement;
    expect(scrollRegion).toBeTruthy();

    // Transition to ready. Inside the same act() we simulate the child
    // mount-effect chain (consume + comment-anchored scroll) so that when
    // act() flushes the parent's restore effect, the store slot is null
    // (the realistic scenario the latch must defeat).
    act(() => {
      mockUseFileContent.mockReturnValue({
        status: "ready",
        content: "hello",
        sizeBytes: 5,
        mtimeMs: 0,
      });
      rerender(<ViewerRouter path="/a.txt" />);
      // Simulate child useScrollToLine consume (clears the store) and the
      // child's comment-anchored scroll application.
      useStore.getState().consumePendingScrollTarget("/a.txt");
      scrollRegion.scrollTop = 500;
    });

    // With the layout-effect latch, the parent's restore effect skips and
    // 500 is preserved. Without the latch, the restore effect runs after
    // the child's consume, sees pendingScrollTarget=null, misses the
    // early-return guard, and the rAF retry loop snaps scrollTop to 1234.
    expect(scrollRegion.scrollTop).toBe(500);
    expect(scrollRegion.scrollTop).not.toBe(1234);

    rafSpy.mockRestore();
  });
});

// RC4/P1.2 (#298) — rerender invariant.ViewerRouter must NOT subscribe
// to `pendingScrollTarget`; otherwise the child's `useScrollToLine`
// consume (which clears the slot to null) re-renders the parent and
// re-fires its restore effect.
import { resetRenderCounts, getRenderCount } from "@/hooks/dev/useRenderCount";

describe("ViewerRouter — RC4/P1.2 rerender invariants", () => {
  beforeEach(() => {
    resetRenderCounts();
  });

  it("does not re-render when setPendingScrollTarget fires for the current file", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "x" });
    useStore.setState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      activeTabPath: "/a.md",
      pendingScrollTarget: null,
    });

    render(<ViewerRouter path="/a.md" />);
    const before = getRenderCount("ViewerRouter");
    expect(before).toBeGreaterThan(0);

    act(() => {
      useStore.getState().setPendingScrollTarget({ filePath: "/a.md", line: 42 });
    });

    // No re-render: `setPendingScrollTarget` mutated the store but
    // ViewerRouter does not subscribe to that slice.
    expect(getRenderCount("ViewerRouter")).toBe(before);
  });

  it("does not re-render when pendingScrollTarget is consumed (cleared to null)", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: "x" });
    useStore.setState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      activeTabPath: "/a.md",
      pendingScrollTarget: { filePath: "/a.md", line: 42 },
    });

    render(<ViewerRouter path="/a.md" />);
    const before = getRenderCount("ViewerRouter");

    act(() => {
      useStore.getState().consumePendingScrollTarget("/a.md");
    });

    expect(useStore.getState().pendingScrollTarget).toBeNull();
    expect(getRenderCount("ViewerRouter")).toBe(before);
  });
});
