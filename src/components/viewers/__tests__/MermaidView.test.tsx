import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MermaidView } from "../MermaidView";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg">mock diagram</svg>' }),
  },
}));

describe("MermaidView", () => {
  it("renders mermaid diagram", async () => {
    render(<MermaidView content="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(screen.getByTitle("Mermaid diagram")).toBeInTheDocument();
    });
  });

  it("shows error for invalid syntax", async () => {
    const mermaid = (await import("mermaid")).default;
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
