import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SourceView } from "../SourceView";

// Match the mocking style of the sibling SourceView.test.tsx so this test
// runs in isolation (no real shiki / real comment hooks).
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
    addComment: vi.fn().mockResolvedValue(undefined),
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
    commitMoveAnchor: vi.fn(),
  })),
}));

describe("SourceView zoom (regression for #92)", () => {
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
    // is the regression-proof contract here.
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
