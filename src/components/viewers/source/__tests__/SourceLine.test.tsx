import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceLine, type SourceLineProps } from "../SourceLine";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

vi.mock("@/components/comments/LineCommentMargin", () => ({
  LineCommentMargin: (props: { lineNumber: number; threads: CommentThread[] }) => (
    <div data-testid="line-comment-margin" data-line={props.lineNumber} data-thread-count={props.threads.length} />
  ),
}));

function renderLine(overrides: Partial<SourceLineProps> = {}) {
  const props: SourceLineProps = {
    idx: 0,
    lineNum: 1,
    line: "const x = 1;",
    filePath: "/test.ts",
    contentHtml: "const x = 1;",
    isSelectionActive: false,
    foldRegion: undefined,
    isCollapsed: false,
    lineThreads: [],
    isCommenting: false,
    isExpanded: false,
    onToggleFold: vi.fn(),
    onCommentButtonClick: vi.fn(),
    onCloseInput: vi.fn(),
    onRequestInput: vi.fn(),
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

  it("renders the LineCommentMargin when lineThreads is non-empty", () => {
    const thread = { root: { line: 1 } } as unknown as CommentThread;
    renderLine({ lineThreads: [thread] });
    const margin = screen.getByTestId("line-comment-margin");
    expect(margin).toBeInTheDocument();
    expect(margin.getAttribute("data-thread-count")).toBe("1");
  });

  it("does not render the margin when there are no threads and not commenting/expanded", () => {
    renderLine();
    expect(screen.queryByTestId("line-comment-margin")).toBeNull();
  });

  it("renders pre-highlighted search HTML via dangerouslySetInnerHTML", () => {
    renderLine({
      contentHtml: 'foo <mark class="search-match-current">bar</mark> baz',
    });
    const mark = document.querySelector("mark.search-match-current");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("bar");
  });

  it("calls onCommentButtonClick with lineNum when the + button is clicked", () => {
    const onCommentButtonClick = vi.fn();
    renderLine({ lineNum: 12, onCommentButtonClick });
    fireEvent.click(screen.getByLabelText("Add comment"));
    expect(onCommentButtonClick).toHaveBeenCalledWith(12);
  });
});
