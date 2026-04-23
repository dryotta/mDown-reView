import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SourceView } from "../SourceView";

vi.mock("@/lib/shiki", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      const lines = code.split("\n");
      const lineSpans = lines.map(() => '<span class="line">highlighted</span>').join("\n");
      return `<pre class="shiki"><code>${lineSpans}</code></pre>`;
    }),
    getLoadedLanguages: vi.fn().mockReturnValue([]),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/logger");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: vi.fn(),
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
  })),
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

  it("renders syntax-highlighted content from shiki", async () => {
    render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" />);
    await waitFor(() => {
      const lineContent = document.querySelector(".source-line-content");
      expect(lineContent).not.toBeNull();
      expect(lineContent!.innerHTML).toBe("highlighted");
    });
  });

  it("renders highlighted content after content prop update", async () => {
    const { rerender } = render(
      <SourceView content={"line1"} path="/test.ts" filePath="/test.ts" />
    );
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    rerender(
      <SourceView content={"lineA\nlineB"} path="/test.ts" filePath="/test.ts" />
    );

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
      const lineContents = document.querySelectorAll(".source-line-content");
      expect(lineContents.length).toBe(2);
      expect(lineContents[0].innerHTML).toBe("highlighted");
      expect(lineContents[1].innerHTML).toBe("highlighted");
    });
  });
});
