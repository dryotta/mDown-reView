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

  it("provides export buttons", () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    expect(screen.getByRole("button", { name: /png/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /svg/i })).toBeInTheDocument();
  });
});
