import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentThread } from "../CommentThread";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

function makeComment(overrides: Partial<CommentWithOrphan> = {}): CommentWithOrphan {
  return {
    id: "comment-1",
    author: "Test User (human)",
    timestamp: new Date("2024-06-15T12:00:00Z").toISOString(),
    text: "This is a comment",
    resolved: false,
    line: 1,
    isOrphaned: false,
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

  it("saving edit calls editComment in store", () => {
    const editCommentSpy = vi.fn();
    useStore.setState({ editComment: editCommentSpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "updated text" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(editCommentSpy).toHaveBeenCalledWith("comment-1", "updated text");
  });

  it("Delete button calls deleteComment in store", () => {
    const deleteCommentSpy = vi.fn();
    useStore.setState({ deleteComment: deleteCommentSpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(deleteCommentSpy).toHaveBeenCalledWith("comment-1");
  });

  it("Resolve button calls resolveComment in store", () => {
    const resolveCommentSpy = vi.fn();
    useStore.setState({ resolveComment: resolveCommentSpy } as never);

    render(<CommentThread rootComment={makeComment({ resolved: false })} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /resolve/i }));

    expect(resolveCommentSpy).toHaveBeenCalledWith("comment-1");
  });

  it("resolved comment shows 'Unresolve' button instead of 'Resolve'", () => {
    render(<CommentThread rootComment={makeComment({ resolved: true })} filePath="/test/file.md" />);

    expect(screen.getByRole("button", { name: /unresolve/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^resolve$/i })).not.toBeInTheDocument();
  });

  it("resolved comment calls unresolveComment when Unresolve is clicked", () => {
    const unresolveCommentSpy = vi.fn();
    useStore.setState({ unresolveComment: unresolveCommentSpy } as never);

    render(<CommentThread rootComment={makeComment({ resolved: true })} filePath="/test/file.md" />);
    fireEvent.click(screen.getByRole("button", { name: /unresolve/i }));

    expect(unresolveCommentSpy).toHaveBeenCalledWith("comment-1");
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
    const addReplySpy = vi.fn();
    useStore.setState({ addReply: addReplySpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "My reply text" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(addReplySpy).toHaveBeenCalledWith("/test/file.md", "comment-1", "My reply text");
  });

  it("clears and hides reply textarea after successful send", () => {
    const addReplySpy = vi.fn();
    useStore.setState({ addReply: addReplySpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "My reply text" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.queryByRole("textbox", { name: /reply/i })).not.toBeInTheDocument();
  });

  it("does not call addReply when Send is clicked with empty text", () => {
    const addReplySpy = vi.fn();
    useStore.setState({ addReply: addReplySpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(addReplySpy).not.toHaveBeenCalled();
  });

  it("does not call addReply when Send is clicked with only whitespace", () => {
    const addReplySpy = vi.fn();
    useStore.setState({ addReply: addReplySpy } as never);

    render(<CommentThread rootComment={makeComment()} filePath="/test/file.md" />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(addReplySpy).not.toHaveBeenCalled();
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
