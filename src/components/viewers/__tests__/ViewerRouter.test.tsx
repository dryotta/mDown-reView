import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ViewerRouter } from "../ViewerRouter";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// Mock child viewers as simple test stubs
vi.mock("../EnhancedViewer", () => ({
  EnhancedViewer: ({ filePath, fileSize }: { filePath: string; fileSize?: number }) => (
    <div data-testid="enhanced-viewer" data-path={filePath} data-filesize={fileSize}>EnhancedViewer</div>
  ),
}));

vi.mock("../ImageViewer", () => ({
  ImageViewer: ({ path }: { path: string }) => (
    <div data-testid="image-viewer" data-path={path}>ImageViewer</div>
  ),
}));

vi.mock("../AudioViewer", () => ({
  AudioViewer: ({ path }: { path: string }) => (
    <div data-testid="audio-viewer" data-path={path}>AudioViewer</div>
  ),
}));

vi.mock("../VideoViewer", () => ({
  VideoViewer: ({ path }: { path: string }) => (
    <div data-testid="video-viewer" data-path={path}>VideoViewer</div>
  ),
}));

vi.mock("../PdfViewer", () => ({
  PdfViewer: ({ path }: { path: string }) => (
    <div data-testid="pdf-viewer" data-path={path}>PdfViewer</div>
  ),
}));

vi.mock("../BinaryPlaceholder", () => ({
  BinaryPlaceholder: ({ path, size }: { path: string; size?: number }) => (
    <div data-testid="binary-placeholder" data-path={path} data-size={size}>BinaryPlaceholder</div>
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

  it("image status routes to ImageViewer", () => {
    mockUseFileContent.mockReturnValue({ status: "image" });
    useStore.setState({ tabs: [{ path: "/photos/test.png", scrollTop: 0 }] });
    render(<ViewerRouter path="/photos/test.png" />);
    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
  });

  it("audio status routes to AudioViewer (#65 F1)", () => {
    mockUseFileContent.mockReturnValue({ status: "audio" });
    useStore.setState({ tabs: [{ path: "/music/song.mp3", scrollTop: 0 }] });
    render(<ViewerRouter path="/music/song.mp3" />);
    expect(screen.getByTestId("audio-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("audio-viewer").dataset.path).toBe("/music/song.mp3");
  });

  it("video status routes to VideoViewer (#65 F2)", () => {
    mockUseFileContent.mockReturnValue({ status: "video" });
    useStore.setState({ tabs: [{ path: "/movies/clip.mp4", scrollTop: 0 }] });
    render(<ViewerRouter path="/movies/clip.mp4" />);
    expect(screen.getByTestId("video-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("video-viewer").dataset.path).toBe("/movies/clip.mp4");
  });

  it("pdf status routes to PdfViewer (#65 F3)", () => {
    mockUseFileContent.mockReturnValue({ status: "pdf" });
    useStore.setState({ tabs: [{ path: "/docs/spec.pdf", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/spec.pdf" />);
    expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-viewer").dataset.path).toBe("/docs/spec.pdf");
  });

  it("loading status shows SkeletonLoader", () => {
    mockUseFileContent.mockReturnValue({ status: "loading" });
    useStore.setState({ tabs: [{ path: "/docs/README.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/README.md" />);
    expect(screen.getByTestId("skeleton-loader")).toBeInTheDocument();
  });

  it("binary status shows BinaryPlaceholder", () => {
    mockUseFileContent.mockReturnValue({ status: "binary" });
    useStore.setState({ tabs: [{ path: "/docs/file.bin", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/file.bin" />);
    expect(screen.getByTestId("binary-placeholder")).toBeInTheDocument();
  });

  it("too_large status shows TooLargePlaceholder (not BinaryPlaceholder)", () => {
    mockUseFileContent.mockReturnValue({ status: "too_large", sizeBytes: 11 * 1024 * 1024 });
    useStore.setState({ tabs: [{ path: "/data/huge.csv", scrollTop: 0 }] });
    render(<ViewerRouter path="/data/huge.csv" />);
    expect(screen.getByTestId("too-large-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("binary-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("too-large-placeholder").dataset.size).toBe(String(11 * 1024 * 1024));
  });

  it("binary status forwards sizeBytes to BinaryPlaceholder", () => {
    mockUseFileContent.mockReturnValue({ status: "binary", sizeBytes: 1234 });
    useStore.setState({ tabs: [{ path: "/docs/file.bin", scrollTop: 0 }] });
    render(<ViewerRouter path="/docs/file.bin" />);
    expect(screen.getByTestId("binary-placeholder").dataset.size).toBe("1234");
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

describe("ViewerRouter fileSize memoization", () => {
  it("passes byte-accurate fileSize for ASCII content", () => {
    const content = "Hello, world!";
    mockUseFileContent.mockReturnValue({ status: "ready", content });
    useStore.setState({ tabs: [{ path: "/test.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/test.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe("13");
  });

  it("passes byte-accurate fileSize for multi-byte content", () => {
    const content = "こんにちは"; // 5 chars, 15 bytes in UTF-8
    mockUseFileContent.mockReturnValue({ status: "ready", content });
    useStore.setState({ tabs: [{ path: "/jp.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/jp.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe("15");
  });

  it("passes undefined fileSize when content is null", () => {
    mockUseFileContent.mockReturnValue({ status: "ready", content: null });
    useStore.setState({ tabs: [{ path: "/empty.txt", scrollTop: 0 }] });
    render(<ViewerRouter path="/empty.txt" />);
    const viewer = screen.getByTestId("enhanced-viewer");
    expect(viewer.dataset.filesize).toBe(undefined);
  });

  it("does not recompute fileSize on unrelated re-renders", () => {
    const content = "stable content";
    mockUseFileContent.mockReturnValue({ status: "ready", content });
    useStore.setState({ tabs: [{ path: "/stable.txt", scrollTop: 0 }] });

    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");

    const { rerender } = render(<ViewerRouter path="/stable.txt" />);
    const callCountAfterFirst = encodeSpy.mock.calls.length;

    // Re-render with same content — useMemo should skip recomputation
    rerender(<ViewerRouter path="/stable.txt" />);
    expect(encodeSpy.mock.calls.length).toBe(callCountAfterFirst);

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
