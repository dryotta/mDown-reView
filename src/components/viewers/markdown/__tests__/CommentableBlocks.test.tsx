import React, { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/components/comments/CommentThread", () => ({
  CommentThread: ({ rootComment }: { rootComment: { id: string } }) => (
    <div data-testid="thread-mock">{rootComment.id}</div>
  ),
}));

vi.mock("@/components/comments/LineCommentMargin", () => ({
  LineCommentMargin: ({
    onCloseInput,
    onSaveComment,
  }: {
    onCloseInput: () => void;
    onSaveComment?: (text: string) => void;
  }) => (
    <div data-testid="line-comment-margin">
      <button data-testid="lcm-close" onClick={onCloseInput}>close</button>
      {onSaveComment && (
        <button data-testid="lcm-save" onClick={() => onSaveComment("hi")}>save</button>
      )}
    </div>
  ),
}));

import {
  MdCommentContext,
  makeCommentableBlock,
  CommentableLi,
  CommentableTableCell,
  CommentableWrapper,
  MdCommentPopover,
} from "../CommentableBlocks";
import type { CommentThread as CommentThreadType, CommentAnchor } from "@/lib/tauri-commands";

// react-markdown's ExtraProps `node` shape we rely on. Cast to bypass strict typing.
const nodeAt = (line: number) =>
  ({ position: { start: { line, column: 1, offset: 0 }, end: { line, column: 1, offset: 0 } } }) as never;

// Helper: render a popover whose bodyRef is wired to a div containing a
// `[data-source-line]` element so the internal effect can resolve a position.
function PopoverHarness(
  props: Omit<React.ComponentProps<typeof MdCommentPopover>, "bodyRef"> & {
    targetLine?: number;
  }
) {
  const ref = useRef<HTMLDivElement>(null);
  const { targetLine, ...rest } = props;
  return (
    <div ref={ref}>
      {targetLine !== undefined && (
        <span data-source-line={targetLine}>line</span>
      )}
      <MdCommentPopover {...rest} bodyRef={ref} />
    </div>
  );
}

describe("makeCommentableBlock", () => {
  it("renders the requested tag inside a wrapper div with data-source-line", () => {
    const Block = makeCommentableBlock("p");
    const { container } = render(
      <Block node={nodeAt(7)}>hello world</Block>
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-source-line")).toBe("7");
    // No comments → no has-comments class and no count attr
    expect(wrapper?.classList.contains("has-comments")).toBe(false);
    expect(wrapper?.getAttribute("data-comment-count")).toBeNull();
    // Inner tag is the requested one and contains children
    const inner = wrapper?.querySelector("p");
    expect(inner).not.toBeNull();
    expect(inner?.textContent).toBe("hello world");
  });

  it("adds has-comments class and data-comment-count when context reports a count", () => {
    const Block = makeCommentableBlock("h2");
    const counts = new Map([[3, 4]]);
    const { container } = render(
      <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
        <Block node={nodeAt(3)}>title</Block>
      </MdCommentContext.Provider>
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.classList.contains("has-comments")).toBe(true);
    expect(wrapper?.getAttribute("data-comment-count")).toBe("4");
    expect(wrapper?.querySelector("h2")?.textContent).toBe("title");
  });

  it("falls back to line=0 when node position is missing", () => {
    const Block = makeCommentableBlock("p");
    const { container } = render(<Block>orphan</Block>);
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.getAttribute("data-source-line")).toBe("0");
  });

  it("wraps a blockquote with data-source-line and toggles has-comments via context", () => {
    const Block = makeCommentableBlock("blockquote");
    const counts = new Map([[5, 2]]);
    const { container } = render(
      <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
        <Block node={nodeAt(5)}>inner</Block>
      </MdCommentContext.Provider>,
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.getAttribute("data-source-line")).toBe("5");
    expect(wrapper?.classList.contains("has-comments")).toBe(true);
    expect(wrapper?.querySelector("blockquote")?.textContent).toBe("inner");
  });

  it("wraps a table whose children are real <thead>/<tbody> elements", () => {
    const Block = makeCommentableBlock("table");
    const { container } = render(
      <Block node={nodeAt(2)}>
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </Block>,
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.getAttribute("data-source-line")).toBe("2");
    expect(wrapper?.querySelector("table")).not.toBeNull();
    expect(wrapper?.querySelector("td")?.textContent).toBe("1");
  });

  it("wraps a void <img> with data-source-line (no children passed)", () => {
    const Block = makeCommentableBlock("img");
    const { container } = render(
      <Block node={nodeAt(3)} />,
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.getAttribute("data-source-line")).toBe("3");
    expect(wrapper?.querySelector("img")).not.toBeNull();
  });

  it("wraps a void <hr> with data-source-line (no children passed by react-markdown)", () => {
    const Block = makeCommentableBlock("hr");
    const counts = new Map([[8, 1]]);
    const { container } = render(
      <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
        <Block node={nodeAt(8)} />
      </MdCommentContext.Provider>,
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper?.getAttribute("data-source-line")).toBe("8");
    expect(wrapper?.classList.contains("has-comments")).toBe(true);
    expect(wrapper?.querySelector("hr")).not.toBeNull();
  });
});

describe("CommentableTableCell", () => {
  it.each(["td", "th"] as const)(
    "applies data-source-line/data-comment-count INLINE on the %s (no extra wrapper)",
    (tag) => {
      const Cell = CommentableTableCell(tag);
      const counts = new Map([[7, 3]]);
      // Render inside a real <table>/<tr> so the cell tag is legal in markup.
      const { container } = render(
        <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
          <table>
            <tbody>
              <tr>
                <Cell node={nodeAt(7)}>cell text</Cell>
              </tr>
            </tbody>
          </table>
        </MdCommentContext.Provider>,
      );
      const cell = container.querySelector(tag);
      expect(cell).not.toBeNull();
      expect(cell?.textContent).toBe("cell text");
      expect(cell?.getAttribute("data-source-line")).toBe("7");
      expect(cell?.getAttribute("data-source-cell-line")).toBe("7");
      expect(cell?.getAttribute("data-comment-count")).toBe("3");
      expect(cell?.classList.contains("md-commentable-cell")).toBe(true);
      expect(cell?.classList.contains("has-comments")).toBe(true);
      // No extra wrapper div was inserted around the cell — the cell sits
      // directly under <tr>.
      expect(cell?.parentElement?.tagName.toLowerCase()).toBe("tr");
    },
  );

  it("omits has-comments and data-comment-count when count is 0", () => {
    const Cell = CommentableTableCell("td");
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <Cell node={nodeAt(2)}>plain</Cell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = container.querySelector("td");
    expect(cell?.getAttribute("data-source-line")).toBe("2");
    expect(cell?.getAttribute("data-comment-count")).toBeNull();
    expect(cell?.classList.contains("has-comments")).toBe(false);
  });

  it("preserves passed className alongside the cell class", () => {
    const Cell = CommentableTableCell("td");
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <Cell node={nodeAt(1)} className="user-cls">
              x
            </Cell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = container.querySelector("td");
    expect(cell?.classList.contains("user-cls")).toBe(true);
    expect(cell?.classList.contains("md-commentable-cell")).toBe(true);
  });
});

describe("CommentableWrapper", () => {
  it("wraps arbitrary children in a div carrying data-source-line + has-comments", () => {
    const counts = new Map([[4, 1]]);
    const { container } = render(
      <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
        <CommentableWrapper node={nodeAt(4)}>
          <pre data-testid="inner-pre">code</pre>
        </CommentableWrapper>
      </MdCommentContext.Provider>,
    );
    const wrapper = container.querySelector(".md-commentable-block");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-source-line")).toBe("4");
    expect(wrapper?.classList.contains("has-comments")).toBe(true);
    expect(wrapper?.querySelector("pre")?.textContent).toBe("code");
  });
});

describe("MdCommentContext", () => {
  it("provides an empty Map as the default commentCountByLine", () => {
    const { result } = renderHook(() => React.useContext(MdCommentContext));
    expect(result.current.commentCountByLine).toBeInstanceOf(Map);
    expect(result.current.commentCountByLine.size).toBe(0);
  });

  it("delivers overridden values to consumers wrapped in a Provider", () => {
    const counts = new Map([[1, 2]]);
    const { result } = renderHook(() => React.useContext(MdCommentContext), {
      wrapper: ({ children }) => (
        <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
          {children}
        </MdCommentContext.Provider>
      ),
    });
    expect(result.current.commentCountByLine).toBe(counts);
    expect(result.current.commentCountByLine.get(1)).toBe(2);
  });
});

describe("CommentableLi", () => {
  it("renders an <li> with children and no has-comments class when count is 0", () => {
    const { container } = render(
      <CommentableLi node={nodeAt(2)}>item text</CommentableLi>
    );
    const li = container.querySelector("li");
    expect(li).not.toBeNull();
    expect(li?.textContent).toBe("item text");
    expect(li?.classList.contains("md-commentable-li")).toBe(true);
    expect(li?.classList.contains("has-comments")).toBe(false);
    expect(li?.getAttribute("data-source-line")).toBe("2");
  });

  it("toggles has-comments based on the context count", () => {
    const counts = new Map([[2, 1]]);
    const { container } = render(
      <MdCommentContext.Provider value={{ commentCountByLine: counts }}>
        <CommentableLi node={nodeAt(2)}>item</CommentableLi>
      </MdCommentContext.Provider>
    );
    const li = container.querySelector("li");
    expect(li?.classList.contains("has-comments")).toBe(true);
    expect(li?.getAttribute("data-comment-count")).toBe("1");
  });
});

describe("MdCommentPopover", () => {
  const baseProps = {
    expandedLine: null as number | null,
    commentingLine: null as number | null,
    threadsByLine: new Map<number, CommentThreadType[]>(),
    filePath: "/tmp/foo.md",
    lines: ["line one", "line two", "line three"],
    pendingSelectionAnchor: null as CommentAnchor | null,
    addComment: vi.fn(async () => {}),
    setCommentingLine: vi.fn(),
    setExpandedLine: vi.fn(),
    clearSelection: vi.fn(),
  };

  it("renders nothing when both expandedLine and commentingLine are null", () => {
    const { container } = render(<PopoverHarness {...baseProps} />);
    expect(container.querySelector(".md-comment-popover")).toBeNull();
  });

  it("renders nothing when no DOM element matches the active line", () => {
    const { container } = render(
      <PopoverHarness {...baseProps} expandedLine={9} /* no targetLine */ />
    );
    expect(container.querySelector(".md-comment-popover")).toBeNull();
  });

  it("renders an Add comment button (and no threads) when there are no threads for the active line", () => {
    render(
      <PopoverHarness
        {...baseProps}
        expandedLine={2}
        targetLine={2}
      />
    );
    expect(screen.queryByTestId("thread-mock")).toBeNull();
    const btn = screen.getByRole("button", { name: /add comment/i });
    expect(btn).toBeInTheDocument();
  });

  it("renders thread mocks when threadsByLine has entries for the active line", () => {
    const threadsByLine = new Map<number, CommentThreadType[]>([
      [
        2,
        [
          {
            root: { id: "c1" } as never,
            replies: [],
          } as CommentThreadType,
        ],
      ],
    ]);
    render(
      <PopoverHarness
        {...baseProps}
        expandedLine={2}
        targetLine={2}
        threadsByLine={threadsByLine}
      />
    );
    expect(screen.getByTestId("thread-mock")).toHaveTextContent("c1");
  });

  it("clicking Add comment calls setCommentingLine with the active line", () => {
    const setCommentingLine = vi.fn();
    render(
      <PopoverHarness
        {...baseProps}
        expandedLine={2}
        targetLine={2}
        setCommentingLine={setCommentingLine}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));
    expect(setCommentingLine).toHaveBeenCalledWith(2);
  });

  it("when commentingLine === activeLine, renders LineCommentMargin and its close calls setCommentingLine(null) + setExpandedLine(null) + clearSelection", () => {
    const setCommentingLine = vi.fn();
    const setExpandedLine = vi.fn();
    const clearSelection = vi.fn();
    render(
      <PopoverHarness
        {...baseProps}
        commentingLine={2}
        targetLine={2}
        setCommentingLine={setCommentingLine}
        setExpandedLine={setExpandedLine}
        clearSelection={clearSelection}
      />
    );
    expect(screen.getByTestId("line-comment-margin")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId("lcm-close"));
    });
    expect(setCommentingLine).toHaveBeenCalledWith(null);
    expect(setExpandedLine).toHaveBeenCalledWith(null);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("passes onSaveComment that calls addComment + clearSelection when pendingSelectionAnchor is set", () => {
    const addComment = vi.fn(async () => {});
    const clearSelection = vi.fn();
    const anchor = {
      contextLines: ["line two"],
      contextStart: 1,
      matchedLineNumber: 2,
      lineText: "line two",
    } as unknown as CommentAnchor;
    render(
      <PopoverHarness
        {...baseProps}
        commentingLine={2}
        targetLine={2}
        pendingSelectionAnchor={anchor}
        addComment={addComment}
        clearSelection={clearSelection}
      />
    );
    fireEvent.click(screen.getByTestId("lcm-save"));
    expect(addComment).toHaveBeenCalledWith("/tmp/foo.md", "hi", anchor);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });
});
