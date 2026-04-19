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
    anchorType: "line" as const,
    lineNumber: 1,
    lineHash: `hash-${id}`,
    text,
    createdAt: new Date().toISOString(),
    resolved: false,
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
          makeComment("3", "Third comment", { lineNumber: 30 }),
          makeComment("1", "First comment", { lineNumber: 10 }),
          makeComment("2", "Second comment", { lineNumber: 20 }),
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
        [FILE]: [makeComment("1", "A comment", { lineNumber: 42 })],
      },
    });

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText(/Line 42/)).toBeInTheDocument();
  });

  it("orphaned comments show warning icon ⚠ next to line number", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Orphaned comment", { isOrphaned: true, lineNumber: 5 }),
          makeComment("2", "Normal comment", { isOrphaned: false, lineNumber: 10 }),
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
          makeComment("1", "Active comment", { lineNumber: 1 }),
          makeComment("2", "Resolved comment", { resolved: true, lineNumber: 2 }),
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
          makeComment("1", "Active comment", { lineNumber: 1 }),
          makeComment("2", "Resolved comment", { resolved: true, lineNumber: 2 }),
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
        [FILE]: [makeComment("1", "Scrollable comment", { lineNumber: 15, matchedLineNumber: 18 })],
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
        [FILE]: [makeComment("1", "Click me", { lineNumber: 7 })],
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
          makeComment("1", "A", { lineNumber: 1 }),
          makeComment("2", "B", { lineNumber: 2 }),
          makeComment("3", "C", { resolved: true, lineNumber: 3 }),
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
          makeComment("a", "Should be second", { lineNumber: 5, matchedLineNumber: 20 }),
          makeComment("b", "Should be first", { lineNumber: 50, matchedLineNumber: 10 }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    const comments = screen.getAllByText(/Should be/).filter((el) => el.classList.contains("comment-text"));
    expect(comments[0]).toHaveTextContent("Should be first");
    expect(comments[1]).toHaveTextContent("Should be second");
  });

  it("displays responses in CommentThread", () => {
    useStore.setState({
      commentsByFile: {
        [FILE]: [
          makeComment("1", "Parent comment", {
            lineNumber: 1,
            responses: [
              { author: "Alice", text: "Good point!", createdAt: "2024-01-15T10:00:00Z" },
              { author: "Bob", text: "I agree", createdAt: "2024-01-15T11:00:00Z" },
            ],
          }),
        ],
      },
    });

    render(<CommentsPanel filePath={FILE} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Good point!")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("I agree")).toBeInTheDocument();
  });
});
