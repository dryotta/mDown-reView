import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { KqlPlanView } from "../KqlPlanView";

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
});
