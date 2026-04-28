import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: () => ({ threads: [], comments: [], loading: false, reload: () => {} }),
}));

vi.mock("@/store", () => {
  const state = {
    toggleCommentsPane: vi.fn(),
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: () => {},
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg">mock diagram</svg>' }),
  },
}));

import { MermaidView } from "../MermaidView";
import mermaid from "mermaid";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MermaidView", () => {
  it("renders mermaid diagram", async () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
  });

  it("shows error for invalid syntax", async () => {
    (mermaid.render as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Parse error"));
    render(<MermaidView content="invalid mermaid" />);
    await waitFor(() => {
      expect(screen.getByText(/error rendering/i)).toBeInTheDocument();
    });
  });

  it("does not render custom toolbar — zoom and export surface through EnhancedViewer toolbar", () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    expect(screen.queryByRole("button", { name: /zoom out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom in/i })).not.toBeInTheDocument();
    expect(document.querySelector(".mermaid-toolbar")).not.toBeInTheDocument();
  });

  it("accepts zoom prop and applies it to the diagram container", async () => {
    const { container } = render(<MermaidView content="graph TD; A-->B;" zoom={1.5} />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
    const diagramDiv = container.querySelector("[title='Mermaid diagram']") as HTMLElement;
    expect(diagramDiv.style.transform).toContain("scale(1.5)");
  });
});
