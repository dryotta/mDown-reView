import { render, screen, waitFor } from "@testing-library/react";
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

  it("renders no inline canvas chrome regardless of `path` (zoom + reset live in chrome ViewerToolbar; Pop-out belongs to MermaidEmbedded only)", async () => {
    // Embedded path (no `path`) — was always chrome-less.
    const { rerender, container } = render(<MermaidView content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    for (const name of [/fit/i, /pop out/i, /zoom in/i, /zoom out/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(container.querySelector(".mermaid-canvas-actions")).toBeNull();

    // Dedicated viewer path (with `path`) — now also chrome-less. Earlier
    // iterations rendered Fit + Pop-out here; both were removed because Fit
    // duplicates the chrome ViewerToolbar's reset and Pop-out is a no-op
    // when the viewer already IS the full-window view.
    rerender(<MermaidView content="graph TD; A-->B;" path="/tmp/diagram.mmd" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    for (const name of [/fit/i, /pop out/i, /zoom in/i, /zoom out/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(container.querySelector(".mermaid-canvas-actions")).toBeNull();
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
});
