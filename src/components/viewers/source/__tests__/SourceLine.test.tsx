import { describe, it, expect, vi } from "vitest";
import { memo, useEffect, useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SourceLine, type SourceLineProps } from "../SourceLine";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

function makeThread(id: string, opts: { resolved?: boolean } = {}): CommentThread {
  return {
    root: { id, resolved: opts.resolved ?? false, replies: [] } as never,
    replies: [],
  } as unknown as CommentThread;
}

function renderLine(overrides: Partial<SourceLineProps> = {}) {
  const props: SourceLineProps = {
    idx: 0,
    lineNum: 1,
    filePath: "/test.ts",
    contentHtml: "const x = 1;",
    isSelectionActive: false,
    foldRegion: undefined,
    isCollapsed: false,
    lineThreads: [],
    onToggleFold: vi.fn(),
    onAddCommentClick: vi.fn(),
    onMarkerClick: vi.fn(),
    ...overrides,
  };
  const utils = render(<SourceLine {...props} />);
  return { ...utils, props };
}

describe("SourceLine", () => {
  it("renders the line content and gutter line number", () => {
    renderLine({ lineNum: 7, contentHtml: "hello world" });
    expect(screen.getByText("7")).toBeInTheDocument();
    const content = document.querySelector(".source-line-content");
    expect(content?.innerHTML).toBe("hello world");
  });

  it("invokes onToggleFold when the fold toggle is clicked", () => {
    const onToggleFold = vi.fn();
    const foldRegion: FoldRegion = { startLine: 3, endLine: 9 };
    renderLine({ lineNum: 3, foldRegion, onToggleFold });
    fireEvent.click(screen.getByLabelText("Collapse"));
    expect(onToggleFold).toHaveBeenCalledWith(3);
  });

  it("renders the collapsed-fold placeholder with hidden-line count when isCollapsed", () => {
    const onToggleFold = vi.fn();
    const foldRegion: FoldRegion = { startLine: 2, endLine: 8 };
    renderLine({ lineNum: 2, foldRegion, isCollapsed: true, onToggleFold });
    const placeholder = document.querySelector(".source-fold-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("5 lines hidden"); // 8 - 2 - 1 = 5
    expect(screen.getByLabelText("Expand")).toBeInTheDocument();
    fireEvent.click(placeholder!);
    expect(onToggleFold).toHaveBeenCalledWith(2);
  });

  it("renders the bubble marker (no `+`) when lineThreads has unresolved threads", () => {
    renderLine({ lineThreads: [makeThread("c1")] });
    expect(screen.getByLabelText(/comment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Add comment")).toBeNull();
  });

  it("does not render the bubble when there are no unresolved threads", () => {
    renderLine();
    // No bubble — the gutter shows the `+` add-comment affordance instead.
    expect(document.querySelector(".comment-marker")).toBeNull();
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
  });

  it("renders pre-highlighted search HTML via dangerouslySetInnerHTML", () => {
    renderLine({
      contentHtml: 'foo <mark class="search-match-current">bar</mark> baz',
    });
    const mark = document.querySelector("mark.search-match-current");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("bar");
  });

  it("calls onAddCommentClick with lineNum when the + button is clicked", () => {
    const onAddCommentClick = vi.fn();
    renderLine({ lineNum: 12, onAddCommentClick });
    fireEvent.click(screen.getByLabelText("Add comment"));
    expect(onAddCommentClick).toHaveBeenCalledWith(12);
  });

  it("calls onMarkerClick with lineNum when the bubble marker is clicked", () => {
    const onMarkerClick = vi.fn();
    renderLine({ lineNum: 9, lineThreads: [makeThread("c1")], onMarkerClick });
    fireEvent.click(screen.getByLabelText(/^1 comment$/));
    expect(onMarkerClick).toHaveBeenCalledWith(9);
  });

  it("adds the 'selection-active' class to the line wrapper when isSelectionActive is true", () => {
    renderLine({ isSelectionActive: true });
    const wrapper = document.querySelector(".source-line");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains("selection-active")).toBe(true);
  });

  it("renders 'N comments' aria-label when ≥2 unresolved threads", () => {
    renderLine({
      lineThreads: [makeThread("a"), makeThread("b")],
    });
    expect(screen.getByLabelText("2 comments")).toBeInTheDocument();
  });

  it("shows the ▾ Collapse toggle and no placeholder when foldRegion is present and isCollapsed=false", () => {
    const foldRegion: FoldRegion = { startLine: 4, endLine: 10 };
    renderLine({ lineNum: 4, foldRegion, isCollapsed: false });
    const toggle = screen.getByLabelText("Collapse");
    expect(toggle).toBeInTheDocument();
    expect(toggle.textContent).toBe("▾");
    expect(document.querySelector(".source-fold-placeholder")).toBeNull();
  });

  it("re-renders only the line whose props changed (React.memo + stable handlers)", () => {
    // Sanity check first: SourceLine itself must be a React.memo component
    // — without that wrapper the parent's stable handlers buy nothing.
    expect((SourceLine as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));

    const renderCounts: Record<number, number> = {};
    const setterRef: { current: ((html: string) => void) | null } = { current: null };

    function CountingSourceLine(props: SourceLineProps) {
      useEffect(() => {
        renderCounts[props.idx] = (renderCounts[props.idx] ?? 0) + 1;
      });
      return <SourceLine {...props} />;
    }
    const MemoCountingSourceLine = memo(CountingSourceLine);

    function Harness() {
      const [line1Html, setLine1Html] = useState("AAA");
      useEffect(() => {
        setterRef.current = setLine1Html;
      }, []);
      // Stable handlers — what the real SourceView does via useCallback.
      const onToggleFold = useStableFn();
      const onAddCommentClick = useStableFn();
      const onMarkerClick = useStableFn();

      const baseProps = {
        filePath: "/test.ts",
        isSelectionActive: false,
        foldRegion: undefined,
        isCollapsed: false,
        lineThreads: STABLE_EMPTY_THREADS,
        onToggleFold,
        onAddCommentClick,
        onMarkerClick,
      } as const;

      return (
        <>
          <MemoCountingSourceLine {...baseProps} idx={0} lineNum={1} contentHtml={line1Html} />
          <MemoCountingSourceLine {...baseProps} idx={1} lineNum={2} contentHtml="BBB" />
          <MemoCountingSourceLine {...baseProps} idx={2} lineNum={3} contentHtml="CCC" />
        </>
      );
    }

    render(<Harness />);
    expect(renderCounts[0]).toBe(1);
    expect(renderCounts[1]).toBe(1);
    expect(renderCounts[2]).toBe(1);

    act(() => setterRef.current?.("AAA-changed"));

    expect(renderCounts[0]).toBe(2);
    expect(renderCounts[1]).toBe(1);
    expect(renderCounts[2]).toBe(1);
  });
});

// ── helpers for the memoization test ───────────────────────────────────────

const STABLE_EMPTY_THREADS: CommentThread[] = [];

function useStableFn() {
  const [fn] = useState(() => () => {});
  return fn;
}
