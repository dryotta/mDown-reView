import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewerRouter } from "../ViewerRouter";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// Mock child viewers as simple test stubs
vi.mock("../EnhancedViewer", () => ({
  EnhancedViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="enhanced-viewer" data-path={filePath}>EnhancedViewer</div>
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

  it("error status shows error message", () => {
    mockUseFileContent.mockReturnValue({ status: "error", error: "file not found" });
    useStore.setState({ tabs: [{ path: "/missing.md", scrollTop: 0 }] });
    render(<ViewerRouter path="/missing.md" />);
    expect(screen.getByText(/Error loading file/)).toBeInTheDocument();
    expect(screen.getByText(/file not found/)).toBeInTheDocument();
  });
});
