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

const addCommentMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: addCommentMock,
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
  })),
}));

describe("SourceView", () => {
  it("renders source content with line numbers", async () => {
    render(<SourceView content={"line1\nline2\nline3"} path="/test.ts" filePath="/test.ts" zoom={1} />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("shows add-comment button on line hover", async () => {
    render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" zoom={1} />);
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
    // Button is always rendered, CSS controls visibility
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
  });

  it("renders syntax-highlighted content from shiki", async () => {
    render(<SourceView content={"const x = 1;"} path="/test.ts" filePath="/test.ts" zoom={1} />);
    await waitFor(() => {
      const lineContent = document.querySelector(".source-line-content");
      expect(lineContent).not.toBeNull();
      expect(lineContent!.innerHTML).toBe("highlighted");
    });
  });

  it("renders highlighted content after content prop update", async () => {
    const { rerender } = render(
      <SourceView content={"line1"} path="/test.ts" filePath="/test.ts" zoom={1} />
    );
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    rerender(
      <SourceView content={"lineA\nlineB"} path="/test.ts" filePath="/test.ts" zoom={1} />
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

describe("zoom (#92)", () => {
  it("scales the .source-lines text container via --source-zoom CSS var", async () => {
    const { container } = render(
      <SourceView content={"hello\nworld"} path="x.ts" filePath="x.ts" zoom={1.5} />,
    );
    // Wait for the async syntax-highlighting effect to settle so the
    // afterEach console-error guard in test-setup doesn't catch act() noise.
    await waitFor(() => {
      expect(container.querySelector(".source-line-content")?.innerHTML).toBe("highlighted");
    });
    const root = container.querySelector(".source-view") as HTMLElement;
    const lines = container.querySelector(".source-lines") as HTMLElement;
    expect(root).toBeTruthy();
    expect(lines).toBeTruthy();
    expect(root.style.getPropertyValue("--source-zoom")).toBe("1.5");
    // jsdom does not compute calc(); the production CSS rule
    //   .source-lines { font-size: calc(13px * var(--source-zoom)); }
    // is what scales the text. Verifying the CSS variable plumbing
    // is the regression-proof contract here. The browser e2e
    // (e2e/browser/zoom-source.spec.ts) asserts the rendered effect.
  });

  it("data-zoom attribute reflects the zoom prop", async () => {
    const { container } = render(
      <SourceView content={"a"} path="x.ts" filePath="x.ts" zoom={1.25} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".source-line-content")?.innerHTML).toBe("highlighted");
    });
    expect(container.querySelector(".source-view")?.getAttribute("data-zoom")).toBe("1.25");
  });

  it("default zoom of 1 sets --source-zoom: 1", async () => {
    const { container } = render(
      <SourceView content={"a"} path="x.ts" filePath="x.ts" zoom={1} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".source-line-content")?.innerHTML).toBe("highlighted");
    });
    const root = container.querySelector(".source-view") as HTMLElement;
    expect(root.style.getPropertyValue("--source-zoom")).toBe("1");
  });
});
