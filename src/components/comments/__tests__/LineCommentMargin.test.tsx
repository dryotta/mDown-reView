import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LineCommentMargin } from "../LineCommentMargin";
import type { CommentThread as CommentThreadType, MatchedComment } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// ── Mock CommentInput: renders Save/Close buttons for interaction ───────────
vi.mock("../CommentInput", () => ({
  CommentInput: ({ onSave, onClose }: { onSave: (t: string) => void; onClose: () => void }) => (
    <div data-testid="comment-input">
      <button onClick={() => onSave("test comment")}>Save</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// ── Mock CommentThread: renders root comment text for verification ──────────
vi.mock("../CommentThread", () => ({
  CommentThread: ({ rootComment }: { rootComment: { text: string } }) => (
    <div data-testid="comment-thread">{rootComment.text}</div>
  ),
}));

// ── Mock useCommentActions ──────────────────────────────────────────────────
const mockAddComment = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: () => ({ addComment: mockAddComment }),
}));

vi.mock("@/lib/tauri-commands");

// ── Helper ─────────────────────────────────────────────────────────────────

function makeThread(opts: {
  text: string;
  resolved?: boolean;
  replies?: { text: string; resolved?: boolean }[];
}): CommentThreadType {
  return {
    root: {
      id: crypto.randomUUID(),
      author: "Test Author (test)",
      timestamp: new Date().toISOString(),
      text: opts.text,
      resolved: opts.resolved ?? false,
      matchedLineNumber: 1,
      isOrphaned: false,
    } as MatchedComment,
    replies: (opts.replies ?? []).map((r) => ({
      id: crypto.randomUUID(),
      author: "Test Author (test)",
      timestamp: new Date().toISOString(),
      text: r.text,
      resolved: r.resolved ?? false,
      matchedLineNumber: 1,
      isOrphaned: false,
    })) as MatchedComment[],
  };
}

const BASE_PROPS = {
  filePath: "/test/file.md",
  lineNumber: 10,
  lineText: "some source line text",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("LineCommentMargin", () => {
  it("returns null when showInput is false and threads is empty", () => {
    const { container } = render(
      <LineCommentMargin {...BASE_PROPS} threads={[]} showInput={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders CommentInput when showInput is true", () => {
    render(
      <LineCommentMargin {...BASE_PROPS} threads={[]} showInput={true} onCloseInput={vi.fn()} />,
    );
    expect(screen.getByTestId("comment-input")).toBeInTheDocument();
  });

  it("shows collapsed count button when threads have unresolved comments", () => {
    const threads = [makeThread({ text: "unresolved comment" })];
    render(<LineCommentMargin {...BASE_PROPS} threads={threads} />);

    const btn = screen.getByRole("button", { name: /1 comment/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByTestId("comment-thread")).not.toBeInTheDocument();
  });

  it("count button shows correct unresolved count including replies", () => {
    const threads = [
      makeThread({
        text: "root unresolved",
        resolved: false,
        replies: [
          { text: "reply unresolved", resolved: false },
          { text: "reply resolved", resolved: true },
        ],
      }),
      makeThread({ text: "root resolved", resolved: true }),
    ];
    render(<LineCommentMargin {...BASE_PROPS} threads={threads} />);

    // 1 (root unresolved) + 1 (reply unresolved) + 0 (reply resolved) + 0 (root resolved) = 2
    expect(screen.getByRole("button", { name: /2 comments/i })).toBeInTheDocument();
  });

  it("clicking count button expands and shows CommentThread entries", () => {
    const threads = [
      makeThread({ text: "first thread" }),
      makeThread({ text: "second thread" }),
    ];
    render(<LineCommentMargin {...BASE_PROPS} threads={threads} />);

    // Initially collapsed
    expect(screen.queryByTestId("comment-thread")).not.toBeInTheDocument();

    // Click the count button
    const btn = screen.getByRole("button", { name: /2 comments/i });
    fireEvent.click(btn);

    // Now expanded
    const threadEls = screen.getAllByTestId("comment-thread");
    expect(threadEls).toHaveLength(2);
    expect(screen.getByText("first thread")).toBeInTheDocument();
    expect(screen.getByText("second thread")).toBeInTheDocument();
  });

  it("when forceExpanded is true, shows threads immediately without count button", () => {
    const threads = [makeThread({ text: "force expanded thread" })];
    render(
      <LineCommentMargin {...BASE_PROPS} threads={threads} forceExpanded={true} />,
    );

    expect(screen.getByTestId("comment-thread")).toBeInTheDocument();
    expect(screen.getByText("force expanded thread")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comment/i })).not.toBeInTheDocument();
  });

  it('"Add comment" button visible when expanded + threads exist + onRequestInput provided', () => {
    const onRequestInput = vi.fn();
    const threads = [makeThread({ text: "some thread" })];
    render(
      <LineCommentMargin
        {...BASE_PROPS}
        threads={threads}
        forceExpanded={true}
        onRequestInput={onRequestInput}
      />,
    );

    const addBtn = screen.getByRole("button", { name: /add comment/i });
    expect(addBtn).toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(onRequestInput).toHaveBeenCalledOnce();
  });

  it('"Add comment" button NOT visible when showInput is already true', () => {
    const onRequestInput = vi.fn();
    const threads = [makeThread({ text: "some thread" })];
    render(
      <LineCommentMargin
        {...BASE_PROPS}
        threads={threads}
        forceExpanded={true}
        showInput={true}
        onCloseInput={vi.fn()}
        onRequestInput={onRequestInput}
      />,
    );

    expect(screen.queryByRole("button", { name: /add comment/i })).not.toBeInTheDocument();
  });

  it("handleSave with onSaveComment prop calls it instead of addComment", async () => {
    const onSaveComment = vi.fn();
    const onCloseInput = vi.fn();

    render(
      <LineCommentMargin
        {...BASE_PROPS}
        threads={[]}
        showInput={true}
        onSaveComment={onSaveComment}
        onCloseInput={onCloseInput}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSaveComment).toHaveBeenCalledWith("test comment");
    });
    expect(mockAddComment).not.toHaveBeenCalled();
    expect(onCloseInput).toHaveBeenCalled();
  });

  it("handleSave without onSaveComment calls addComment via VM hook with correct anchor data", async () => {
    const onCloseInput = vi.fn();

    render(
      <LineCommentMargin
        {...BASE_PROPS}
        threads={[]}
        showInput={true}
        onCloseInput={onCloseInput}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockAddComment).toHaveBeenCalledWith(
        "/test/file.md",
        "test comment",
        {
          line: 10,
          selected_text: "some source line text",
        },
      );
    });
    expect(onCloseInput).toHaveBeenCalled();
  });
});
