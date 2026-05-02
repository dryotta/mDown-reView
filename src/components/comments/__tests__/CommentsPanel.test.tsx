import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentsPanel } from "../CommentsPanel";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import type {
  Anchor,
  MatchedComment,
  CommentThread as CommentThreadType,
} from "@/lib/tauri-commands";

// Test-only type: extends the wire `MatchedComment` shape with the
// optional in-memory `anchor` field. Production code never reads
// `comment.anchor` directly (the canonical path is `deriveAnchor(c)`),
// but the mocked `useComments` bypasses that conversion, so fixtures
// set `anchor` to drive the derivation switch without populating the
// v1.1 sibling fields explicitly.
type FixtureComment = MatchedComment & { anchor?: Anchor };

vi.mock("@tauri-apps/api/core");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

const mockAddComment = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/vm/use-comment-actions", () => ({
  useCommentActions: vi.fn(() => ({
    addComment: mockAddComment,
    addReply: vi.fn(),
    editComment: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    resolveComment: vi.fn().mockResolvedValue(undefined),
    unresolveComment: vi.fn().mockResolvedValue(undefined),
    resolveFocusedThread: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockUseComments = vi.mocked(useComments);
const mockUseCommentActions = vi.mocked(useCommentActions);

const FILE = "/docs/README.md";

function makeComment(
  id: string,
  text: string,
  overrides: Partial<FixtureComment> = {}
): FixtureComment {
  return {
    id,
    author: "Test User (human)",
    timestamp: new Date().toISOString(),
    text,
    resolved: false,
    line: 1,
    matchedLineNumber: overrides.matchedLineNumber ?? overrides.line ?? 1,
    isOrphaned: false,
    anchor: { kind: "line", line: overrides.line ?? 1 },
    ...overrides,
  };
}

function makeThread(root: FixtureComment, replies: FixtureComment[] = []): CommentThreadType {
  return { root, replies };
}

function setMockComments(threads: CommentThreadType[]) {
  const allComments = threads.flatMap((t) => [t.root, ...t.replies]);
  mockUseComments.mockReturnValue({
    threads,
    comments: allComments,
    loading: false,
    reload: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddComment.mockReset().mockResolvedValue(undefined);
  mockUseCommentActions.mockReturnValue({
    addComment: mockAddComment,
    addReply: vi.fn(),
    editComment: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    resolveComment: vi.fn().mockResolvedValue(undefined),
    unresolveComment: vi.fn().mockResolvedValue(undefined),
    resolveFocusedThread: vi.fn().mockResolvedValue(undefined),
  });
  mockUseComments.mockReturnValue({ threads: [], comments: [], loading: false, reload: vi.fn() });
  useStore.setState({ pendingFileLevelInputFor: null });
});

// ─── 14.3: CommentsPanel behavior ────────────────────────────────────────────

describe("14.3 – CommentsPanel", () => {
  it("shows 'No comments yet' when there are no comments", () => {
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("lists unresolved comments sorted by line number", () => {
    setMockComments([
      makeThread(makeComment("3", "Third comment", { line: 30, matchedLineNumber: 30 })),
      makeThread(makeComment("1", "First comment", { line: 10, matchedLineNumber: 10 })),
      makeThread(makeComment("2", "Second comment", { line: 20, matchedLineNumber: 20 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    const commentEls = document.querySelectorAll(".comment-text");
    expect(commentEls[0]).toHaveTextContent("First comment");
    expect(commentEls[1]).toHaveTextContent("Second comment");
    expect(commentEls[2]).toHaveTextContent("Third comment");
  });

  it("shows line number prefix for each comment", () => {
    setMockComments([
      makeThread(makeComment("1", "A comment", { line: 42, matchedLineNumber: 42 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText(/Line 42/)).toBeInTheDocument();
  });

  it("orphaned comments show warning icon ⚠ next to line number", () => {
    setMockComments([
      makeThread(
        makeComment("1", "Orphaned comment", { isOrphaned: true, line: 5, matchedLineNumber: 5 })
      ),
      makeThread(
        makeComment("2", "Normal comment", { isOrphaned: false, line: 10, matchedLineNumber: 10 })
      ),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    // Panel shows orphan icon next to line number, CommentThread also shows one in header
    const orphanIcons = screen.getAllByText("⚠");
    expect(orphanIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("'Show resolved' toggle shows resolved comments", () => {
    setMockComments([
      makeThread(makeComment("1", "Active comment", { line: 1, matchedLineNumber: 1 })),
      makeThread(
        makeComment("2", "Resolved comment", { resolved: true, line: 2, matchedLineNumber: 2 })
      ),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    expect(screen.getByText("Active comment")).toBeInTheDocument();
    expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show resolved/i));

    expect(screen.getByText("Active comment")).toBeInTheDocument();
    expect(screen.getByText("Resolved comment")).toBeInTheDocument();
  });

  it("'Hide resolved' toggle hides resolved comments again", () => {
    setMockComments([
      makeThread(makeComment("1", "Active comment", { line: 1, matchedLineNumber: 1 })),
      makeThread(
        makeComment("2", "Resolved comment", { resolved: true, line: 2, matchedLineNumber: 2 })
      ),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    fireEvent.click(screen.getByText(/show resolved/i));
    expect(screen.getByText("Resolved comment")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hide resolved/i));
    expect(screen.queryByText("Resolved comment")).not.toBeInTheDocument();
  });

  it("clicking a comment calls onScrollToLine with resolved line number", () => {
    const onScrollToLine = vi.fn();

    setMockComments([
      makeThread(makeComment("1", "Scrollable comment", { line: 15, matchedLineNumber: 18 })),
    ]);

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const commentItem = document.querySelector(".comment-panel-item")!;
    fireEvent.click(commentItem);

    expect(onScrollToLine).toHaveBeenCalledWith(18);
  });

  it("clicking a comment dispatches scroll-to-line custom event", () => {
    const handler = vi.fn();
    window.addEventListener("scroll-to-line", handler);

    setMockComments([makeThread(makeComment("1", "Click me", { line: 7, matchedLineNumber: 7 }))]);

    render(<CommentsPanel filePath={FILE} />);

    const commentItem = document.querySelector(".comment-panel-item")!;
    fireEvent.click(commentItem);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.line).toBe(7);

    window.removeEventListener("scroll-to-line", handler);
  });

  // ─── Iter 3 / #280 G1: clicking a panel row emits CommentFlashDetail
  // tagged with the correct `kind` per anchor type. Spy on the raw
  // `dispatchEvent` so we can introspect the CustomEvent payload. ────
  describe("emits comment-flash with the correct kind discriminator", () => {
    function captureFlashDetails(): import("@/lib/comment-flash").CommentFlashDetail[] {
      const captured: import("@/lib/comment-flash").CommentFlashDetail[] = [];
      vi.spyOn(window, "dispatchEvent").mockImplementation((e: Event) => {
        if (e.type === "comment-flash") {
          captured.push(
            (e as CustomEvent<import("@/lib/comment-flash").CommentFlashDetail>).detail
          );
        }
        return true;
      });
      return captured;
    }

    it("kind:'line' for a single-line anchor", () => {
      setMockComments([
        makeThread(
          makeComment("c-line", "Line anchor", {
            line: 5,
            matchedLineNumber: 5,
            anchor: { kind: "line", line: 5 },
          })
        ),
      ]);
      const captured = captureFlashDetails();
      render(<CommentsPanel filePath={FILE} />);
      fireEvent.click(document.querySelector(".comment-panel-item")!);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        kind: "line",
        filePath: FILE,
        line: 5,
        commentId: "c-line",
      });
    });

    it("kind:'range' for an end_line > matchedLineNumber anchor", () => {
      setMockComments([
        makeThread(
          makeComment("c-range", "Range anchor", {
            line: 3,
            end_line: 7,
            matchedLineNumber: 3,
            anchor: { kind: "line", line: 3, end_line: 7 },
          })
        ),
      ]);
      const captured = captureFlashDetails();
      render(<CommentsPanel filePath={FILE} />);
      fireEvent.click(document.querySelector(".comment-panel-item")!);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        kind: "range",
        filePath: FILE,
        line: 3,
        endLine: 7,
        commentId: "c-range",
      });
    });

    it("kind:'file' for an anchor_kind='file' comment", () => {
      setMockComments([
        makeThread(
          makeComment("c-file", "File anchor", {
            anchor_kind: "file",
            matchedLineNumber: 0,
            anchor: { kind: "file" },
          })
        ),
      ]);
      const captured = captureFlashDetails();
      render(<CommentsPanel filePath={FILE} />);
      fireEvent.click(document.querySelector(".comment-panel-item")!);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        kind: "file",
        filePath: FILE,
        commentId: "c-file",
      });
    });

    it("kind:'unmatched' for an orphaned comment", () => {
      setMockComments([
        makeThread(
          makeComment("c-orphan", "Orphan", {
            isOrphaned: true,
            line: 99,
            matchedLineNumber: 0,
            anchor: { kind: "line", line: 99 },
          })
        ),
      ]);
      const captured = captureFlashDetails();
      render(<CommentsPanel filePath={FILE} />);
      fireEvent.click(document.querySelector(".comment-panel-item")!);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        kind: "unmatched",
        filePath: FILE,
        commentId: "c-orphan",
      });
    });
  });

  it("shows unresolved count in header", () => {
    setMockComments([
      makeThread(makeComment("1", "A", { line: 1, matchedLineNumber: 1 })),
      makeThread(makeComment("2", "B", { line: 2, matchedLineNumber: 2 })),
      makeThread(makeComment("3", "C", { resolved: true, line: 3, matchedLineNumber: 3 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText("Comments (2)")).toBeInTheDocument();
  });

  it("uses matchedLineNumber for sorting when available", () => {
    setMockComments([
      makeThread(makeComment("a", "Should be second", { line: 5, matchedLineNumber: 20 })),
      makeThread(makeComment("b", "Should be first", { line: 50, matchedLineNumber: 10 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    const commentEls = document.querySelectorAll(".comment-text");
    expect(commentEls[0]).toHaveTextContent("Should be first");
    expect(commentEls[1]).toHaveTextContent("Should be second");
  });

  it("comment items have role='button' and tabIndex for keyboard access", () => {
    setMockComments([
      makeThread(makeComment("1", "Accessible comment", { line: 5, matchedLineNumber: 5 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    const item = document.querySelector(".comment-panel-item")!;
    expect(item).toHaveAttribute("role", "button");
    expect(item).toHaveAttribute("tabindex", "0");
  });

  it("pressing Enter on a comment item calls onScrollToLine", () => {
    const onScrollToLine = vi.fn();

    setMockComments([
      makeThread(makeComment("1", "Keyboard comment", { line: 10, matchedLineNumber: 12 })),
    ]);

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Enter" });

    expect(onScrollToLine).toHaveBeenCalledWith(12);
  });

  it("pressing Space on a comment item calls onScrollToLine", () => {
    const onScrollToLine = vi.fn();

    setMockComments([
      makeThread(makeComment("1", "Space comment", { line: 7, matchedLineNumber: 7 })),
    ]);

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: " " });

    expect(onScrollToLine).toHaveBeenCalledWith(7);
  });

  it("pressing Enter on a comment dispatches scroll-to-line event", () => {
    const handler = vi.fn();
    window.addEventListener("scroll-to-line", handler);

    setMockComments([
      makeThread(makeComment("1", "Event comment", { line: 20, matchedLineNumber: 20 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Enter" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.line).toBe(20);

    window.removeEventListener("scroll-to-line", handler);
  });

  it("other keys on a comment item do not trigger navigation", () => {
    const onScrollToLine = vi.fn();

    setMockComments([
      makeThread(makeComment("1", "No trigger", { line: 3, matchedLineNumber: 3 })),
    ]);

    render(<CommentsPanel filePath={FILE} onScrollToLine={onScrollToLine} />);

    const item = document.querySelector(".comment-panel-item")!;
    fireEvent.keyDown(item, { key: "Tab" });
    fireEvent.keyDown(item, { key: "Escape" });
    fireEvent.keyDown(item, { key: "a" });

    expect(onScrollToLine).not.toHaveBeenCalled();
  });

  it("displays reply comments threaded under parent", () => {
    setMockComments([
      makeThread(makeComment("1", "Parent comment", { line: 1, matchedLineNumber: 1 }), [
        makeComment("reply-1", "Good point!", {
          line: 1,
          matchedLineNumber: 1,
          reply_to: "1",
          author: "Alice (human)",
        }),
        makeComment("reply-2", "I agree", {
          line: 1,
          matchedLineNumber: 1,
          reply_to: "1",
          author: "Bob (human)",
        }),
      ]),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    expect(screen.getByText("Good point!")).toBeInTheDocument();
    expect(screen.getByText("I agree")).toBeInTheDocument();
  });
});

// ─── Iter 5 Group B: file-level comment entry point ──────────────────────────

describe("CommentsPanel — file-level comment entry (iter 5 group B)", () => {
  it("'+' button is disabled when filePath is empty", () => {
    render(<CommentsPanel filePath="" />);
    const addBtn = screen.getByRole("button", { name: /comment on file/i });
    expect(addBtn).toBeDisabled();
  });

  it("'+' button is enabled when filePath is non-empty", () => {
    render(<CommentsPanel filePath={FILE} />);
    const addBtn = screen.getByRole("button", { name: /comment on file/i });
    expect(addBtn).not.toBeDisabled();
  });

  it("clicking '+' opens an inline CommentInput above the thread list", () => {
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Save calls addComment with { kind: 'file' } anchor", async () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "high-level note" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockAddComment).toHaveBeenCalledWith(FILE, "high-level note", { kind: "file" });
    // Iter 3 (#280) AC6 — handler is async; let the resolved IPC settle so
    // the post-success setState (close input) flushes before the next test.
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    );
  });

  it("Save closes the inline input on successful save", async () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Iter 3 (#280) AC6 — handler is async; the input closes only after the
    // awaited addComment resolves.
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    );
  });

  it("Cancel hides the inline input without saving", () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  it("auto-opens input when pendingFileLevelInputFor === filePath and clears the flag", () => {
    useStore.setState({ pendingFileLevelInputFor: FILE });
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(useStore.getState().pendingFileLevelInputFor).toBeNull();
  });

  it("does NOT auto-open input when pendingFileLevelInputFor targets a different file", () => {
    useStore.setState({ pendingFileLevelInputFor: "/some/other.md" });
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Foreign request must not be consumed by us
    expect(useStore.getState().pendingFileLevelInputFor).toBe("/some/other.md");
  });

  // ── Failure surface: AC6 (iter 3 / #280) ──────────────────────────────────
  // For non-typed errors (the common addComment failure path), the panel now
  // RETHROWS so CommentInput's local `.comment-input-error` banner surfaces
  // the failure inside the composer — the user can read the message AND
  // retry without losing the textarea text. The panel-level banner remains
  // scoped to the typed `outside-workspace` self-heal (test below).

  it("non-typed addComment rejection surfaces inside CommentInput (composer stays open)", async () => {
    mockAddComment.mockRejectedValueOnce(new Error("network down"));
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "binary note" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // CommentInput's inline banner shows the rejection message.
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveClass("comment-input-error");
    expect(banner.textContent).toMatch(/network down/);
    // Composer stays mounted so the user can retry without retyping.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("binary note");
  });

  it("does not show an error banner on a successful save", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Wait for the input to close (success path).
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── Issue #338 / Wave-2 — typed CommentError self-heal ───────────────────
  // When the comment IPC rejects with the canonical wire shape
  // `{ kind: "outside-workspace", path }` the panel marks the tab read-only
  // (so the next composer mount is pre-disabled) AND surfaces a banner
  // explaining the workspace boundary. Legacy string-based rejections
  // continue to fall through to the existing error-banner path.
  it("CommentError 'outside-workspace' marks the tab read-only and surfaces a workspace banner", async () => {
    // Seed the store with a tab matching FILE so setTabReadOnly's map can
    // patch a real entry.
    useStore.setState({
      tabs: [{ path: FILE, scrollTop: 0 }],
      activeTabPath: FILE,
    });
    mockAddComment.mockRejectedValueOnce({ kind: "outside-workspace", path: FILE });

    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/outside the workspace/i);
    // Self-heal: the matching tab entry is now read-only.
    const tab = useStore.getState().tabs.find((t) => t.path === FILE);
    expect(tab?.readOnly).toBe(true);
  });
});

// ─── Iter 6 Group A C5 — file-level "+" composer draftKey persistence ───────

describe("CommentsPanel — file-level draft persistence (iter 6 C5)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists draft to localStorage on type and clears on Save", async () => {
    const { unmount } = render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "WIP draft" } });

    // Some key in localStorage now contains the draft text.
    const stored = Object.entries(localStorage).find(([, v]) => v === "WIP draft");
    expect(stored).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Iter 3 (#280) AC6 — Save is async; draft clears after the awaited
    // addComment resolves.
    await waitFor(() => {
      const remaining = Object.entries(localStorage).find(([, v]) => v === "WIP draft");
      expect(remaining).toBeUndefined();
    });
    unmount();
  });

  it("clears draft on Cancel", () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "to discard" } });
    expect(Object.entries(localStorage).find(([, v]) => v === "to discard")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(Object.entries(localStorage).find(([, v]) => v === "to discard")).toBeUndefined();
  });
});

// ─── File-level threads render a "File" pill, not "Line ?" ───────────────────

describe("CommentsPanel — file-level thread rendering", () => {
  it('renders a "File" pill for threads whose root anchor.kind is "file"', () => {
    setMockComments([
      makeThread(
        makeComment("file-1", "high-level note", {
          line: 0,
          matchedLineNumber: 1,
          anchor: { kind: "file" },
        })
      ),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    // The accessible / visible label uses the literal text "File" (the 📄
    // glyph is decorative). We assert the label is in the document and that
    // no "Line ?" or "Line N" label appears for this thread row.
    expect(screen.getByLabelText(/file-level comment/i)).toBeInTheDocument();
    expect(screen.getByText(/File/, { selector: ".comment-panel-file-pill" })).toBeInTheDocument();
    // The thread item header must not say "Line".
    expect(screen.queryByText(/^Line\s/)).not.toBeInTheDocument();
  });

  it('still renders "Line N" for a regular line-anchored thread', () => {
    setMockComments([
      makeThread(
        makeComment("line-1", "line note", {
          line: 7,
          matchedLineNumber: 7,
          anchor: { kind: "line", line: 7 },
        })
      ),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText(/Line 7/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/file-level comment/i)).not.toBeInTheDocument();
  });
});
