import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/tauri-commands", () => ({
  parseKql: vi.fn(async (query: string) => {
    if (!query.trim()) return [];
    // Minimal in-test pipeline parser that splits on top-level `|`.
    const segments = query.split("|").map((s) => s.trim()).filter(Boolean);
    return segments.map((seg, i) => {
      if (i === 0) {
        return { step: 1, operator: seg, details: "", isSource: true };
      }
      const parts = seg.split(/\s+/);
      return {
        step: i + 1,
        operator: parts[0] ?? "",
        details: parts.slice(1).join(" "),
        isSource: false,
      };
    });
  }),
}));

vi.mock("@/store", () => {
  const state = {
    zoomByFiletype: {} as Record<string, number>,
    bumpZoom: () => {},
    setZoom: () => {},
  };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  (useStore as unknown as { getState: () => typeof state }).getState = () => state;
  return { useStore };
});

import { KqlPlanView } from "../KqlPlanView";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("KqlPlanView", () => {
  it("renders formatted query and operator table", async () => {
    render(<KqlPlanView content="Events | where Level == 'Error' | summarize count() by Source" />);
    expect((await screen.findAllByText("where")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("summarize")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/3 operators/)).toBeInTheDocument();
  });

  it("handles empty content", () => {
    render(<KqlPlanView content="" />);
    expect(screen.getByText(/no query/i)).toBeInTheDocument();
  });

  it("applies data-zoom and fontSize style on root container", () => {
    const { container } = render(<KqlPlanView content="" />);
    const root = container.querySelector(".kql-plan-container") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("data-zoom")).toBe("1");
    expect(root.style.fontSize).toBe("100%");
  });
});
