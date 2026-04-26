import React, { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/comments/CommentThread", () => ({
  CommentThread: () => <div data-testid="thread-mock" />,
}));
vi.mock("@/components/comments/LineCommentMargin", () => ({
  LineCommentMargin: () => <div data-testid="line-comment-margin" />,
}));

import { MarkdownInteractionLayer } from "../MarkdownInteractionLayer";
import type { CommentThread as CommentThreadType, CommentAnchor } from "@/lib/tauri-commands";

function Harness(
  props: Omit<React.ComponentProps<typeof MarkdownInteractionLayer>, "bodyRef"> & {
    targetLine?: number;
  },
) {
  const ref = useRef<HTMLDivElement>(null);
  const { targetLine, ...rest } = props;
  return (
    <div ref={ref}>
      {targetLine !== undefined && <span data-source-line={targetLine}>line</span>}
      <MarkdownInteractionLayer {...rest} bodyRef={ref} />
    </div>
  );
}

const baseProps: Omit<React.ComponentProps<typeof MarkdownInteractionLayer>, "bodyRef"> = {
  expandedLine: null,
  commentingLine: null,
  threadsByLine: new Map<number, CommentThreadType[]>(),
  filePath: "/x.md",
  lines: ["a", "b"],
  pendingSelectionAnchor: null as CommentAnchor | null,
  addComment: vi.fn(async () => {}),
  setCommentingLine: vi.fn(),
  setExpandedLine: vi.fn(),
  clearSelection: vi.fn(),
  selectionToolbar: null,
  dismissSelectionToolbar: vi.fn(),
  onAddSelectionComment: vi.fn(),
};

describe("MarkdownInteractionLayer", () => {
  it("renders nothing when there is no active line and no selection toolbar", () => {
    const { container } = render(<Harness {...baseProps} />);
    expect(container.querySelector(".md-comment-popover")).toBeNull();
    expect(container.querySelector(".selection-toolbar")).toBeNull();
  });

  it("renders the MdCommentPopover when a line is expanded", () => {
    render(<Harness {...baseProps} expandedLine={1} targetLine={1} />);
    // The popover surfaces an Add comment button when no thread exists for that line.
    expect(screen.getByRole("button", { name: /add comment/i })).toBeInTheDocument();
  });

  it("renders the SelectionToolbar when selectionToolbar is non-null and dispatches onAddSelectionComment on click", () => {
    const onAdd = vi.fn();
    render(
      <Harness
        {...baseProps}
        selectionToolbar={{ position: { top: 10, left: 20 } }}
        onAddSelectionComment={onAdd}
      />,
    );
    const btn = screen.getByRole("button", { name: /add comment on selection/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("dismisses the SelectionToolbar via the ESC keydown wired by the toolbar (calls dismissSelectionToolbar)", () => {
    const dismiss = vi.fn();
    render(
      <Harness
        {...baseProps}
        selectionToolbar={{ position: { top: 10, left: 20 } }}
        dismissSelectionToolbar={dismiss}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
