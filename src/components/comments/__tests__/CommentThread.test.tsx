import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentThread } from "../CommentThread";
import type { MatchedComment } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const mockEditComment = vi.fn().mockResolvedValue(undefined);
const mockDeleteComment = vi.fn().mockResolvedValue(undefined);
const mockResolveComment = vi.fn().mockResolvedValue(undefined);
const mockUnresolveComment = vi.fn().mockResolvedValue(undefined);
const mockAddReply = vi.fn().mockResolvedValue(undefined);
const mockAddComment = vi.fn().mockResolvedValue(undefined);
const mockAddReaction = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: mockAddComment,
    addReply: mockAddReply,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    resolveComment: mockResolveComment,
    unresolveComment: mockUnresolveComment,
    addReaction: mockAddReaction,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeComment(overrides: Partial<MatchedComment> = {}): MatchedComment {
  return {
    id: "comment-1",
    author: "Test User (human)",
    timestamp: new Date("2024-06-15T12:00:00Z").toISOString(),
    text: "This is a comment",
    resolved: false,
    line: 1,
    matchedLineNumber: 1,
    isOrphaned: false,
    anchor: { kind: "line", line: 1 },
    ...overrides,
  };
}

// ─── Existing functionality (preserved) ────────────────────────────────────────

describe("CommentThread - existing functionality", () => {
  it("renders comment text", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    expect(screen.getByText("This is a comment")).toBeInTheDocument();
  });

  it("renders a timestamp", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    const dateEl = document.querySelector(".comment-timestamp");
    expect(dateEl).toBeInTheDocument();
    expect(dateEl?.textContent).not.toBe("");
  });

  it("Edit button makes comment editable", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("saving edit calls editComment with filePath", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "updated text" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mockEditComment).toHaveBeenCalledWith("/test/file.md", "comment-1", "updated text");
  });

  it("Delete button calls deleteComment with filePath", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(mockDeleteComment).toHaveBeenCalledWith("/test/file.md", "comment-1");
  });

  it("Resolve button calls resolveComment with filePath", () => {
    render(<CommentThread rootComment={makeComment({ resolved: false })} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /resolve/i }));

    expect(mockResolveComment).toHaveBeenCalledWith("/test/file.md", "comment-1");
  });

  it("resolved comment shows 'Unresolve' button instead of 'Resolve'", () => {
    render(<CommentThread rootComment={makeComment({ resolved: true })} filePath="/test/file.md" />);

    expect(screen.getByRole("button", { name: /unresolve/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^resolve$/i })).not.toBeInTheDocument();
  });

  it("resolved comment calls unresolveComment when Unresolve is clicked", () => {
    render(<CommentThread rootComment={makeComment({ resolved: true })} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /unresolve/i }));

    expect(mockUnresolveComment).toHaveBeenCalledWith("/test/file.md", "comment-1");
  });
});

// ─── Author badge ────────────────────────────────────────────────────────────

describe("CommentThread - Author badges", () => {
  it("renders author badge with author text", () => {
    render(<CommentThread rootComment={makeComment({ author: "Test User (human)" })} filePath="/test/file.md" />);

    const badge = document.querySelector(".comment-author-badge");
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("Test User (human)");
  });

  it("renders author badge for agent author", () => {
    render(<CommentThread rootComment={makeComment({ author: "AI Agent (agent)" })} filePath="/test/file.md" />);

    const badge = document.querySelector(".comment-author-badge");
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("AI Agent (agent)");
  });
});

// ─── Orphan banner ───────────────────────────────────────────────────────────

describe("CommentThread - Orphan banner", () => {
  it("shows orphan banner when isOrphaned is true", () => {
    render(<CommentThread rootComment={makeComment({ isOrphaned: true })} filePath="/test/file.md" />);

    const banner = document.querySelector(".comment-orphan-banner");
    expect(banner).toBeInTheDocument();
    expect(banner?.textContent).toBe("⚠ Original location not found — comment may need manual review");
  });

  it("does not show orphan banner when isOrphaned is false", () => {
    render(<CommentThread rootComment={makeComment({ isOrphaned: false })} filePath="/test/file.md" />);

    const banner = document.querySelector(".comment-orphan-banner");
    expect(banner).not.toBeInTheDocument();
  });

  it("does not show orphan banner when isOrphaned is undefined", () => {
    render(<CommentThread rootComment={makeComment({ isOrphaned: undefined })} filePath="/test/file.md" />);

    const banner = document.querySelector(".comment-orphan-banner");
    expect(banner).not.toBeInTheDocument();
  });

  it("does not show old ⚠ icon when using orphan banner", () => {
    render(<CommentThread rootComment={makeComment({ isOrphaned: true })} filePath="/test/file.md" />);

    const oldIcon = document.querySelector(".comment-orphaned-icon");
    expect(oldIcon).not.toBeInTheDocument();
  });
});

// ─── Reply action ────────────────────────────────────────────────────────────

describe("CommentThread - Reply action", () => {
  it("renders Reply button in actions row", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    const replyButton = screen.getByRole("button", { name: /reply/i });
    expect(replyButton).toBeInTheDocument();
  });

  it("shows reply textarea when Reply button is clicked", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    expect(textarea).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("hides reply textarea when Cancel is clicked", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("textbox", { name: /reply/i })).not.toBeInTheDocument();
  });

  it("calls addReply when Send is clicked with valid text", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "My reply text" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(mockAddReply).toHaveBeenCalledWith("/test/file.md", "comment-1", "My reply text");
  });

  it("clears and hides reply textarea after successful send", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "My reply text" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.queryByRole("textbox", { name: /reply/i })).not.toBeInTheDocument();
  });

  it("does not call addReply when Send is clicked with empty text", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(mockAddReply).not.toHaveBeenCalled();
  });

  it("does not call addReply when Send is clicked with only whitespace", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(mockAddReply).not.toHaveBeenCalled();
  });

  it("shows reply input area when Reply is clicked", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const replyInput = document.querySelector(".comment-thread-reply-input");
    expect(replyInput).toBeInTheDocument();
  });

  it("auto-focuses reply textarea when opened", async () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });
});

// ─── Thread with replies ─────────────────────────────────────────────────────

describe("CommentThread - Replies rendering", () => {
  it("renders replies inside thread card", () => {
    const root = makeComment();
    const replies = [
      makeComment({ id: "reply-1", text: "Good point!", author: "Alice (human)" }),
      makeComment({ id: "reply-2", text: "I agree", author: "Bob (human)" }),
    ];

    render(<CommentThread rootComment={root} replies={replies} filePath="/test/file.md" />);

    expect(screen.getByText("Good point!")).toBeInTheDocument();
    expect(screen.getByText("I agree")).toBeInTheDocument();
  });

  it("replies are inside .comment-thread-replies container", () => {
    const root = makeComment();
    const replies = [makeComment({ id: "reply-1", text: "A reply" })];

    render(<CommentThread rootComment={root} replies={replies} filePath="/test/file.md" />);

    const repliesContainer = document.querySelector(".comment-thread-replies");
    expect(repliesContainer).toBeInTheDocument();
  });

  it("replies do not have Reply or Resolve buttons", () => {
    const root = makeComment();
    const replies = [makeComment({ id: "reply-1", text: "A reply" })];

    render(<CommentThread rootComment={root} replies={replies} filePath="/test/file.md" />);

    // There should be exactly one Reply button (on the root) and one Resolve button (on the root)
    const replyButtons = screen.getAllByRole("button", { name: /reply/i });
    expect(replyButtons).toHaveLength(1);
  });
});

// ─── Markdown rendering ──────────────────────────────────────────────────────

describe("CommentThread - Markdown rendering", () => {
  it("renders bold markdown as <strong>", () => {
    render(<CommentThread rootComment={makeComment({ text: "This is **bold** text" })} filePath="/test/file.md" />);

    const strong = document.querySelector(".comment-text strong");
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe("bold");
  });

  it("renders plain text without markdown artifacts", () => {
    render(<CommentThread rootComment={makeComment({ text: "Just plain text" })} filePath="/test/file.md" />);

    expect(screen.getByText("Just plain text")).toBeInTheDocument();
  });

  it("renders links as <a> tags", () => {
    render(<CommentThread rootComment={makeComment({ text: "See [docs](https://example.com)" })} filePath="/test/file.md" />);

    const link = document.querySelector(".comment-text a") as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link?.href).toBe("https://example.com/");
    expect(link?.textContent).toBe("docs");
  });

  it("renders inline code with <code> tags", () => {
    render(<CommentThread rootComment={makeComment({ text: "Use `console.log()` here" })} filePath="/test/file.md" />);

    const code = document.querySelector(".comment-text code");
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toBe("console.log()");
  });

  it("renders bullet lists as <ul>/<li>", () => {
    render(<CommentThread rootComment={makeComment({ text: "Items:\n- one\n- two\n- three" })} filePath="/test/file.md" />);

    const listItems = document.querySelectorAll(".comment-text li");
    expect(listItems).toHaveLength(3);
    expect(listItems[0]?.textContent).toBe("one");
    expect(listItems[1]?.textContent).toBe("two");
    expect(listItems[2]?.textContent).toBe("three");
  });

  it("uses a div wrapper instead of p for comment-text", () => {
    render(<CommentThread rootComment={makeComment({ text: "Some text" })} filePath="/test/file.md" />);

    const commentText = document.querySelector(".comment-text");
    expect(commentText).toBeInTheDocument();
    expect(commentText?.tagName).toBe("DIV");
  });

  it("applies md-wrap-cascade class to comment-text surface (#153)", () => {
    render(<CommentThread rootComment={makeComment({ text: "wrap test" })} filePath="/test/file.md" />);

    const commentText = document.querySelector(".comment-text");
    expect(commentText).toBeInTheDocument();
    expect(commentText?.classList.contains("md-wrap-cascade")).toBe(true);
  });
});

// ─── Move button gating (iter-4 P1) ────────────────────────────────────────────
//
// Move-anchor mode targets a source line. Line/File anchors map cleanly; typed
// anchors (CSV cell, JSON path, HTML range/element, image rect, word range)
// would silently demote to Line on commit, losing payload information. The
// button must be hidden on those root comments.

describe("CommentThread - Move button anchor-kind gating", () => {
  it("shows Move button for line-anchored root comment", () => {
    render(
      <CommentThread
        rootComment={makeComment({ anchor: { kind: "line", line: 1 } })}
        filePath="/test/file.md"
      />
    );
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("shows Move button for file-anchored root comment", () => {
    render(
      <CommentThread
        rootComment={makeComment({ anchor: { kind: "file" } })}
        filePath="/test/file.md"
      />
    );
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("hides Move button for csv_cell-anchored root comment", () => {
    render(
      <CommentThread
        rootComment={makeComment({
          anchor: {
            kind: "csv_cell",
            row_idx: 1,
            col_idx: 2,
            col_header: "name",
          },
        })}
        filePath="/test/file.csv"
      />
    );
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
  });

  it("hides Move button for html_range-anchored root comment", () => {
    render(
      <CommentThread
        rootComment={makeComment({
          anchor: {
            kind: "html_range",
            selector_path: "p",
            start_offset: 0,
            end_offset: 5,
            selected_text: "hello",
          },
        })}
        filePath="/test/file.html"
      />
    );
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
  });
});

// ─── Iter 6 F4 — quick reactions row ───────────────────────────────────────

describe("CommentThread — quick reactions (iter 6 F4)", () => {
  it("renders 👍 / ✓ / ✗ reaction buttons under the comment", () => {
    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    expect(screen.getByRole("button", { name: /thumbs up/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it.each([
    ["thumbs up", "thumbsup"],
    ["acknowledge", "ack"],
    ["dismiss", "dismiss"],
  ])("clicking %s button dispatches addReaction with kind=%s", (label, kind) => {
    render(<CommentThread rootComment={makeComment({ id: "c-42" })} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    expect(mockAddReaction).toHaveBeenCalledWith("/test/file.md", "c-42", kind);
  });

  it("renders existing reaction counts grouped by kind", () => {
    const c = makeComment({
      reactions: [
        { user: "alice", kind: "thumbsup", ts: "2024-01-01T00:00:00Z" },
        { user: "bob", kind: "thumbsup", ts: "2024-01-02T00:00:00Z" },
        { user: "alice", kind: "ack", ts: "2024-01-03T00:00:00Z" },
      ],
    });
    render(<CommentThread rootComment={c} filePath="/test/file.md" />);
    const thumbsup = screen.getByRole("button", { name: /thumbs up/i });
    expect(thumbsup.querySelector(".comment-reaction-count")?.textContent).toBe("2");
    const ack = screen.getByRole("button", { name: /acknowledge/i });
    expect(ack.querySelector(".comment-reaction-count")?.textContent).toBe("1");
    // Dismiss has no reactions, so no count badge.
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect(dismiss.querySelector(".comment-reaction-count")).toBeNull();
  });
});
