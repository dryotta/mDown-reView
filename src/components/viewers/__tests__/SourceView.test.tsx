import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SourceView } from "../SourceView";

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue("<pre><code>highlighted</code></pre>"),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/logger");

vi.mock("@/lib/tauri-commands", () => ({
  loadReviewComments: vi.fn().mockResolvedValue(null),
  saveReviewComments: vi.fn().mockResolvedValue(undefined),
}));

describe("SourceView", () => {
  it("renders source content with line numbers", async () => {
    render(<SourceView content={"line1\nline2\nline3"} path="/test.ts" filePath="/test.ts" />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("shows add-comment button on line hover", async () => {
    render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
    // Button is always rendered, CSS controls visibility
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
  });
});
