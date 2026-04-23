import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentsPanel } from "../CommentsPanel";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const FILE = "/docs/README.md";

function makeComment(
  id: string,
  text: string,
  overrides: Partial<CommentWithOrphan> = {}
): CommentWithOrphan {
  return {
    id,
    author: "Test User (human)",
    timestamp: new Date().toISOString(),
    text,
    resolved: false,
    line: 1,
    isOrphaned: false,
    ...overrides,
  };
}

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  useStore.setState({ commentsByFile: {} });
});

// ─── 14.3: CommentsPanel behavior ────────────────────────────────────────────

describe("14.3 – CommentsPanel", () => {
  it("shows 'No comments yet' when there are no comments", () => {
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("lists unresolved comments sorted by line number", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("3", "Third comment", { line: 30 }),
          makeComment("1", "First comment", { line: 10 }),
          makeComment("2", "Second comment", { line: 20 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const comments = screen.getAllByText(/comment/i).filter((el) => el.classList.contains("comment-text"));
    expect(comments[0]).toHaveTextContent("First comment");
    expect(comments[1]).toHaveTextContent("Second comment");
    expect(comments[2]).toHaveTextContent("Third comment");
  });

  it("shows line number prefix for each comment", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "A comment", { line: 42 })],
      },
    });

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText(/Line 42/)).toBeInTheDocument();
  });

  it("orphaned comments show warning icon ⚠ next to line number", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Orphaned comment", { isOrphaned: true, line: 5 }),
          makeComment("2", "Normal comment", { isOrphaned: false, line: 10 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);
    // Panel shows orphan icon next to line number, CommentThread also shows one in header
    const orphanIcons = screen.getAllByText("⚠");
    expect(orphanIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("'Show resolved' toggle shows resolved comments", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Active comment", { line: 1 }),
          makeComment("2", "Resolved comment", { resolved: true, line: 2 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    expect(screen.getByText("Active comment")).toBeInTheDocument();
    expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show resolved/i));

    expect(screen.getByText("Active comment")).toBeInTheDocument();
    expect(screen.getByText("Resolved comment")).toBeInTheDocument();
  });

  it("'Hide resolved' toggle hides resolved comments again", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Active comment", { line: 1 }),
          makeComment("2", "Resolved comment", { resolved: true, line: 2 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    fireEvent.click(screen.getByText(/show resolved/i));
    expect(screen.getByText("Resolved comment")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hide resolved/i));
    expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument();
  });

  it("clicking a comment calls onScrollToLine with resolved line number", () => {
    const onScrollToLine = vi.fn();

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Scrollable comment", { line: 15, matchedLineNumber: 18 })],
      },
    });

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const commentItem = document.querySelector(".comment-panel-item")!;
    fireEvent.click(commentItem);

    expect(onScrollToLine).toHaveBeenCalledWith(18);
  });

  it("clicking a comment dispatches scroll-to-line custom event", () => {
    const handler = vi.fn();
    window.addEventListener("scroll-to-line", handler);

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Click me", { line: 7 })],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const commentItem = document.querySelector(".comment-panel-item")!;
    fireEvent.click(commentItem);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.line).toBe(7);

    window.removeEventListener("scroll-to-line", handler);
  });

  it("shows unresolved count in header", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "A", { line: 1 }),
          makeComment("2", "B", { line: 2 }),
          makeComment("3", "C", { resolved: true, line: 3 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText("Comments (2)")).toBeInTheDocument();
  });

  it("uses matchedLineNumber for sorting when available", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("a", "Should be second", { line: 5, matchedLineNumber: 20 }),
          makeComment("b", "Should be first", { line: 50, matchedLineNumber: 10 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const comments = screen.getAllByText(/Should be/).filter((el) => el.classList.contains("comment-text"));
    expect(comments[0]).toHaveTextContent("Should be first");
    expect(comments[1]).toHaveTextContent("Should be second");
  });

  it("comment items have role='button' and tabIndex for keyboard access", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Accessible comment", { line: 5 })],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const item = document.querySelector(".comment-panel-item")!;
    expect(item).toHaveAttribute("role", "button");
    expect(item).toHaveAttribute("tabindex", "0");
  });

  it("pressing Enter on a comment item calls onScrollToLine", () => {
    const onScrollToLine = vi.fn();

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Keyboard comment", { line: 10, matchedLineNumber: 12 })],
      },
    });

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Enter" });

    expect(onScrollToLine).toHaveBeenCalledWith(12);
  });

  it("pressing Space on a comment item calls onScrollToLine", () => {
    const onScrollToLine = vi.fn();

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Space comment", { line: 7 })],
      },
    });

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: " " });

    expect(onScrollToLine).toHaveBeenCalledWith(7);
  });

  it("pressing Enter on a comment dispatches scroll-to-line event", () => {
    const handler = vi.fn();
    window.addEventListener("scroll-to-line", handler);

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "Event comment", { line: 20 })],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Enter" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.line).toBe(20);

    window.removeEventListener("scroll-to-line", handler);
  });

  it("other keys on a comment item do not trigger navigation", () => {
    const onScrollToLine = vi.fn();

    useStore.setState({
      commentsByFile: {
        [FILE]: [makeComment("1", "No trigger", { line: 3 })],
      },
    });

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Tab" });
    fireEvent.keyDown(item, { key: "Escape" });
    fireEvent.keyDown(item, { key: "a" });

    expect(onScrollToLine).not.toHaveBeenCalled();
  });

  it("displays reply comments threaded under parent", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Parent comment", { line: 1 }),
          makeComment("reply-1", "Good point!", { line: 1, reply_to: "1", author: "Alice (human)" }),
          makeComment("reply-2", "I agree", { line: 1, reply_to: "1", author: "Bob (human)" }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    expect(screen.getByText("Good point!")).toBeInTheDocument();
    expect(screen.getByText("I agree")).toBeInTheDocument();
  });
});
