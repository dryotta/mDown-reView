import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    commitMoveAnchor: vi.fn(),
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

describe("SourceView — F6 right-click context menu", () => {
  // Capture the original clipboard descriptor once so each test that
  // installs a stub can restore the real navigator.clipboard afterwards
  // (jsdom shares one navigator across the whole file).
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "clipboard",
  ) ?? Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    addCommentMock.mockClear();
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      // No descriptor existed (older jsdom) — drop the stub if any.
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  function openContextMenuOn(content: string, lineIdx: number) {
    render(<SourceView content={content} path="/test.ts" filePath="/test.ts" zoom={1} />);
    return waitFor(() => {
      const lineEl = document.querySelector<HTMLElement>(`[data-line-idx="${lineIdx}"]`);
      expect(lineEl).not.toBeNull();
      fireEvent.contextMenu(lineEl!, { clientX: 50, clientY: 60 });
      expect(document.querySelector(".comment-context-menu")).not.toBeNull();
    });
  }

  it("right-click renders the menu with the three actions", async () => {
    await openContextMenuOn("aaa\nbbb\nccc", 1);
    expect(screen.getByRole("menuitem", { name: /Comment on selection/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Copy link to line/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Mark line as discussed/i })).toBeTruthy();
  });

  it("Comment on selection is disabled when there is no selection", async () => {
    // Default jsdom has no Selection — collapsed.
    await openContextMenuOn("aaa\nbbb", 0);
    const btn = screen.getByRole("menuitem", { name: /Comment on selection/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Mark line as discussed calls addComment with severity=none + text=discussed", async () => {
    await openContextMenuOn("aaa\nbbb\nccc", 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Mark line as discussed/i }));
    await waitFor(() => expect(addCommentMock).toHaveBeenCalled());
    const call = addCommentMock.mock.calls[0];
    expect(call[0]).toBe("/test.ts");        // filePath
    expect(call[1]).toBe("discussed");        // text
    expect(call[2]).toEqual({ kind: "line", line: 2 }); // anchor (idx 1 + 1)
    expect(call[3]).toBeUndefined();          // commentType
    expect(call[4]).toBe("none");             // severity
  });

  it("Copy link to line writes mdrv:// URL to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await openContextMenuOn("aaa\nbbb\nccc", 2);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy link to line/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const link = writeText.mock.calls[0][0] as string;
    expect(link).toMatch(/^mdrv:\/\/.*\?line=3$/);
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
