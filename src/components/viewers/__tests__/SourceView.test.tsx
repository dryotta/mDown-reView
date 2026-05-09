import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SourceView } from "../SourceView";
import { installVirtualizerViewportShim } from "@/test-setup";

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
  // Iter 2 of #252 — virtualised SourceView depends on real layout
  // measurements. Opt-in jsdom shim provides a synthetic 800-px viewport
  // so `@tanstack/react-virtual` produces a non-empty range. Other tests
  // (and other component tests in this suite) do NOT see the shim.
  let teardown: (() => void) | null = null;
  beforeAll(() => {
    teardown = installVirtualizerViewportShim(800);
  });
  afterAll(() => {
    teardown?.();
  });
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

  // Iter 2 of #252 — virtualisation regression. Renders a 50K-line file
  // and asserts only a viewport-bounded window is mounted in the DOM.
  // The exact upper bound depends on `SOURCE_OVERSCAN`, the synthetic
  // 800-px viewport in test-setup.ts, and `SOURCE_BASE_LINE_PX` — all
  // imported from `viewer-budgets.ts`, the canonical source.
  it("virtualises rows — only viewport+overscan rows mount for a 50K-line file", async () => {
    const { SOURCE_OVERSCAN, SOURCE_BASE_LINE_PX } = await import(
      "@/lib/viewer-budgets"
    );
    // 800 px synthetic viewport (test-setup.ts) / 22 px per row = ~36
    // viewport rows. `defaultRangeExtractor` adds overscan to each end:
    // total upper bound = viewportRows + overscan*2.
    const viewportRows = Math.ceil(800 / SOURCE_BASE_LINE_PX);
    const upperBound = viewportRows + SOURCE_OVERSCAN * 2;

    const lines = Array.from({ length: 50_000 }, (_, i) => `line${i + 1}`);
    render(
      <SourceView
        content={lines.join("\n")}
        path="/big.ts"
        filePath="/big.ts"
        zoom={1}
      />
    );

    // Wait for the virtualiser to commit at least one row before measuring.
    await waitFor(() => {
      expect(
        document.querySelectorAll(".source-line").length
      ).toBeGreaterThan(0);
    });

    const renderedRows = document.querySelectorAll(".source-line").length;
    expect(renderedRows).toBeLessThanOrEqual(upperBound);
    // Sanity: must be far less than the total line count, otherwise we
    // have a regression to non-virtualised rendering.
    expect(renderedRows).toBeLessThan(500);
  });

  // Iter 2 of #252 — scroll save/restore regression. Because `.source-lines`
  // is now the inner scroll container, the existing tab-level `scrollTop`
  // save/restore in `ViewerRouter` is a no-op for source-mode tabs. Verify
  // SourceView itself reads the saved value on mount and writes via
  // `setSourceScrollTop` on scroll. The new field is partitioned from
  // `scrollTop` (which still owns visual-mode scroll) so cross-mode toggles
  // never cross-pollute coordinate spaces.
  it("saves scroll position to tab.sourceScrollTop on scroll", async () => {
    const { useStore } = await import("@/store");
    await useStore.getState().openFile("/scroll.ts");

    // Force RAF to fire synchronously so the throttled save lands inside
    // the test's `fireEvent` act() boundary. Mirrors the pattern in
    // `ViewerRouter.test.tsx`.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    render(
      <SourceView
        content={lines.join("\n")}
        path="/scroll.ts"
        filePath="/scroll.ts"
        zoom={1}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".source-lines")).not.toBeNull();
    });

    const sourceLines = document.querySelector(".source-lines") as HTMLDivElement;
    fireEvent.scroll(sourceLines, { target: { scrollTop: 320 } });

    const tab = useStore.getState().tabs.find((t) => t.path === "/scroll.ts");
    expect(tab?.sourceScrollTop).toBe(320);
    // Coord-space partition: visual-mode `scrollTop` must NOT be touched.
    expect(tab?.scrollTop).toBe(0);

    rafSpy.mockRestore();
  });
});

describe("zoom (#92)", () => {
  // Same shim scope — these tests render SourceView and need the virtualiser
  // to mount rows so the zoom CSS plumbing can be observed.
  let teardown: (() => void) | null = null;
  beforeAll(() => {
    teardown = installVirtualizerViewportShim(800);
  });
  afterAll(() => {
    teardown?.();
  });
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
