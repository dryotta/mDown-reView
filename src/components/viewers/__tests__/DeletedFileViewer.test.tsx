import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeletedFileViewer } from "../DeletedFileViewer";
import { useComments } from "@/lib/vm/use-comments";
import type { MatchedComment, CommentThread as CommentThreadType } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: vi.fn(),
    addReply: vi.fn(),
    editComment: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    resolveComment: vi.fn().mockResolvedValue(undefined),
    unresolveComment: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockUseComments = vi.mocked(useComments);

const FILE_PATH = "/project/src/deleted-file.ts";

function makeComment(
  id: string,
  text: string,
  overrides: Partial<MatchedComment> = {}
): MatchedComment {
  return {
    id,
    author: "Test User (human)",
    timestamp: new Date().toISOString(),
    text,
    resolved: false,
    line: 1,
    matchedLineNumber: overrides.matchedLineNumber ?? overrides.line ?? 1,
    isOrphaned: true,
    anchor: { kind: "line", line: overrides.line ?? 1 },
    ...overrides,
  };
}

function makeThread(
  root: MatchedComment,
  replies: MatchedComment[] = []
): CommentThreadType {
  return { root, replies };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseComments.mockReturnValue({ threads: [], comments: [], loading: false, reload: vi.fn() });
});

describe("DeletedFileViewer", () => {
  it("shows deleted file banner with filename", () => {
    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(screen.getByText("🗑️ File Deleted")).toBeInTheDocument();
    expect(screen.getByText("deleted-file.ts")).toBeInTheDocument();
  });

  it("shows 'No comments found' when there are no comments", () => {
    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(screen.getByText("No comments found in the review sidecar.")).toBeInTheDocument();
  });

  it("shows comment count when comments exist", () => {
    const threads = [
      makeThread(makeComment("1", "First orphaned comment")),
      makeThread(makeComment("2", "Second orphaned comment")),
    ];
    const allComments = threads.flatMap(t => [t.root, ...t.replies]);
    mockUseComments.mockReturnValue({ threads, comments: allComments, loading: false, reload: vi.fn() });

    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(screen.getByText("2 comments from the review sidecar:")).toBeInTheDocument();
  });

  it("renders comment threads from useComments hook", () => {
    const threads = [
      makeThread(makeComment("1", "Orphaned review comment")),
    ];
    const allComments = threads.flatMap(t => [t.root, ...t.replies]);
    mockUseComments.mockReturnValue({ threads, comments: allComments, loading: false, reload: vi.fn() });

    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(screen.getByText("Orphaned review comment")).toBeInTheDocument();
  });

  it("calls useComments with the correct filePath", () => {
    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(mockUseComments).toHaveBeenCalledWith(FILE_PATH);
  });

  it("shows orphan banner for orphaned comments", () => {
    const threads = [
      makeThread(makeComment("1", "Orphaned", { isOrphaned: true })),
    ];
    const allComments = threads.flatMap(t => [t.root, ...t.replies]);
    mockUseComments.mockReturnValue({ threads, comments: allComments, loading: false, reload: vi.fn() });

    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(document.querySelector(".comment-orphan-banner")).toBeInTheDocument();
  });

  it("singular comment count for single comment", () => {
    const threads = [makeThread(makeComment("1", "Only comment"))];
    const allComments = threads.flatMap(t => [t.root, ...t.replies]);
    mockUseComments.mockReturnValue({ threads, comments: allComments, loading: false, reload: vi.fn() });

    render(<DeletedFileViewer filePath={FILE_PATH} />);
    expect(screen.getByText("1 comment from the review sidecar:")).toBeInTheDocument();
  });
});
