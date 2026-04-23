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

vi.mock("../BinaryPlaceholder", () => ({
  BinaryPlaceholder: ({ path }: { path: string }) => (
    <div data-testid="binary-placeholder" data-path={path}>BinaryPlaceholder</div>
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

  it("too_large status shows BinaryPlaceholder", () => {
    mockUseFileContent.mockReturnValue({ status: "too_large" });
    useStore.setState({ tabs: [{ path: "/data/huge.csv", scrollTop: 0 }] });
    render(<ViewerRouter path="/data/huge.csv" />);
    expect(screen.getByTestId("binary-placeholder")).toBeInTheDocument();
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
