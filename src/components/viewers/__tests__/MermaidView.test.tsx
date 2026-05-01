import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({ threads: [], comments: [], loading: false, reload: () => {} }),
}));

vi.mock("@/hooks/useTheme", () => ({ useTheme: () => "light" }));

const renderMermaidMock = vi.fn().mockResolvedValue({
  svg: '<svg data-testid="mermaid-svg"><g class="node">A</g></svg>',
});

vi.mock("@/lib/mermaid-singleton", () => ({
  renderMermaid: (...args: unknown[]) => renderMermaidMock(...args),
}));

const storeState = {
  zoomByFiletype: {} as Record<string, number>,
  setZoom: vi.fn(),
  bumpZoom: vi.fn(),
  openMermaidPopout: vi.fn(),
  closeMermaidPopout: vi.fn(),
};

vi.mock("@/store", () => {
  const useStore = (selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState;
  (useStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  return { useStore };
});

import { MermaidView } from "../MermaidView";

beforeEach(() => {
  vi.clearAllMocks();
  renderMermaidMock.mockResolvedValue({
    svg: '<svg data-testid="mermaid-svg"><g class="node">A</g></svg>',
  });
  storeState.zoomByFiletype = {};
  storeState.setZoom.mockReset();
  storeState.bumpZoom.mockReset();
  storeState.openMermaidPopout.mockReset();
});

describe("MermaidView", () => {
  it("renders mermaid diagram", async () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
  });

  it("shows error for invalid syntax", async () => {
    // Suppress expected console.error from React's error capture / our
    // explicit error render path per docs/test-strategy.md console-spy contract.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderMermaidMock.mockRejectedValueOnce(new Error("Parse error"));
    render(<MermaidView content="invalid mermaid" />);
    await waitFor(() => {
      expect(screen.getByText(/error rendering/i)).toBeInTheDocument();
    });
    errSpy.mockRestore();
  });

  it("hides inline controls when no path is provided (embedded markdown-block path)", async () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    // Wait for async mermaid render to settle so React's act warning doesn't fire.
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /fit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pop out/i })).not.toBeInTheDocument();
    // Zoom in/out/reset live in the chrome ViewerToolbar — never inside MermaidView.
    expect(screen.queryByRole("button", { name: /zoom in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom out/i })).not.toBeInTheDocument();
  });

  it("shows Fit + Pop-out (but not zoom in/out) when path is provided (dedicated viewer)", async () => {
    render(<MermaidView content="graph TD; A-->B;" path="/tmp/diagram.mmd" />);
    expect(await screen.findByRole("button", { name: /fit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pop out/i })).toBeInTheDocument();
    // Flush the async mermaid render before ending the test.
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    // Chrome ViewerToolbar is the only zoom in/out surface.
    expect(screen.queryByRole("button", { name: /zoom in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom out/i })).not.toBeInTheDocument();
  });

  it("accepts zoom prop and applies it to the canvas transform wrapper", async () => {
    const { container } = render(
      <MermaidView content="graph TD; A-->B;" path="/tmp/diagram.mmd" zoom={1.5} />,
    );
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    const transformDiv = container.querySelector(".mermaid-canvas-transform") as HTMLElement | null;
    expect(transformDiv).not.toBeNull();
    expect(transformDiv!.style.transform).toContain("scale(1.5)");
  });

  it("clicking Pop-out invokes openMermaidPopout(content, path)", async () => {
    const content = "graph TD; A-->B;";
    const path = "/tmp/diagram.mmd";
    render(<MermaidView content={content} path={path} />);
    fireEvent.click(await screen.findByRole("button", { name: /pop out/i }));
    expect(storeState.openMermaidPopout).toHaveBeenCalledTimes(1);
    expect(storeState.openMermaidPopout).toHaveBeenCalledWith(content, path);
    // Flush async render.
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
  });
});
