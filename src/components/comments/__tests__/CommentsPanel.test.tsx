import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CommentsPanel } from "../CommentsPanel";
import { useComments } from "@/lib/vm/use-comments";
import { useWorkspaceComments } from "@/lib/vm/useWorkspaceComments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import type { MatchedComment, CommentThread as CommentThreadType } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/lib/vm/use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

vi.mock("@/lib/vm/useWorkspaceComments", () => ({
  useWorkspaceComments: vi.fn(() => ({})),
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
    commitMoveAnchor: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    resolveFocusedThread: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockUseComments = vi.mocked(useComments);
const mockUseCommentActions = vi.mocked(useCommentActions);
const mockUseWorkspaceComments = vi.mocked(useWorkspaceComments);

const FILE = "/docs/README.md";

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
    isOrphaned: false,
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

function setMockComments(threads: CommentThreadType[]) {
  const allComments = threads.flatMap(t => [t.root, ...t.replies]);
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
    commitMoveAnchor: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    resolveFocusedThread: vi.fn().mockResolvedValue(undefined),
  });
  mockUseComments.mockReturnValue({ threads: [], comments: [], loading: false, reload: vi.fn() });
  mockUseWorkspaceComments.mockReturnValue({});
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
      makeThread(makeComment("1", "Orphaned comment", { isOrphaned: true, line: 5, matchedLineNumber: 5 })),
      makeThread(makeComment("2", "Normal comment", { isOrphaned: false, line: 10, matchedLineNumber: 10 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    // Panel shows orphan icon next to line number, CommentThread also shows one in header
    const orphanIcons = screen.getAllByText("⚠");
    expect(orphanIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("'Show resolved' toggle shows resolved comments", () => {
    setMockComments([
      makeThread(makeComment("1", "Active comment", { line: 1, matchedLineNumber: 1 })),
      makeThread(makeComment("2", "Resolved comment", { resolved: true, line: 2, matchedLineNumber: 2 })),
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
      makeThread(makeComment("2", "Resolved comment", { resolved: true, line: 2, matchedLineNumber: 2 })),
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

    setMockComments([
      makeThread(makeComment("1", "Click me", { line: 7, matchedLineNumber: 7 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);

    const commentItem = document.querySelector(".comment-panel-item")!;
    fireEvent.click(commentItem);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.line).toBe(7);

    window.removeEventListener("scroll-to-line", handler);
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
      makeThread(
        makeComment("1", "Parent comment", { line: 1, matchedLineNumber: 1 }),
        [
          makeComment("reply-1", "Good point!", { line: 1, matchedLineNumber: 1, reply_to: "1", author: "Alice (human)" }),
          makeComment("reply-2", "I agree", { line: 1, matchedLineNumber: 1, reply_to: "1", author: "Bob (human)" }),
        ]
      ),
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

  it("Save calls addComment with { kind: 'file' } anchor", () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "high-level note" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockAddComment).toHaveBeenCalledWith(FILE, "high-level note", { kind: "file" });
  });

  it("Save closes the inline input", () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
});

// ─── Iter 6 Group A C5 — file-level "+" composer draftKey persistence ───────

describe("CommentsPanel — file-level draft persistence (iter 6 C5)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists draft to localStorage on type and clears on Save", () => {
    const { unmount } = render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "WIP draft" } });

    // Some key in localStorage now contains the draft text.
    const stored = Object.entries(localStorage).find(([, v]) => v === "WIP draft");
    expect(stored).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Slot is cleared on Save.
    const remaining = Object.entries(localStorage).find(([, v]) => v === "WIP draft");
    expect(remaining).toBeUndefined();
    unmount();
  });

  it("clears draft on Cancel", () => {
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /comment on file/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "to discard" } });
    expect(
      Object.entries(localStorage).find(([, v]) => v === "to discard"),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      Object.entries(localStorage).find(([, v]) => v === "to discard"),
    ).toBeUndefined();
  });
});

// ─── Iter 6 F2 — Export review summary button ──────────────────────────────

describe("CommentsPanel — Export review summary (iter 6 F2)", () => {
  let originalClipboard: typeof navigator.clipboard;
  let originalRoot: string | null;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalRoot = useStore.getState().root;
    // Default workspace root for these tests; tests may override.
    useStore.setState({ root: "/ws" });
    // Provide a clipboard mock that vitest can spy on.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    // testing-library's afterEach (cleanup) is registered first and runs
    // last (LIFO). Unmount before mutating store state so a re-render of a
    // still-mounted CommentsPanel doesn't fire an act() warning.
    cleanup();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    useStore.setState({ root: originalRoot });
  });

  it("renders the Export button in the panel header", () => {
    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByRole("button", { name: /export review summary/i })).toBeInTheDocument();
  });

  it("clicking Export invokes export_review_summary IPC with workspace root and copies markdown to clipboard", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce("# Review Summary\n- thread");

    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /export review summary/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("export_review_summary", { workspace: "/ws" });
    });
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Review Summary\n- thread");
    });
    expect(await screen.findByText(/exported to clipboard/i)).toBeInTheDocument();
  });

  it("falls back to filePath when no workspace root is set", async () => {
    useStore.setState({ root: null });
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce("# x");
    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /export review summary/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("export_review_summary", { workspace: FILE });
    });
  });

  // A3 (iter 7) — token race guard. If a slow first click resolves AFTER
  // a fast second click, only the second click's status must be visible.
  // B4 (iter 7 forward-fix) — additionally, the stale first export must
  // NOT write its (stale) markdown to the clipboard after the second
  // click has already settled. Token check moved before `clipboard.writeText`.
  it("ignores the first export's resolution when a second click resolves first", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();

    let resolveFirst!: (v: string) => void;
    const firstPromise = new Promise<string>((r) => { resolveFirst = r; });
    let rejectSecond!: (e: unknown) => void;
    const secondPromise = new Promise<string>((_r, rej) => { rejectSecond = rej; });

    vi.mocked(invoke)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => secondPromise);

    render(<CommentsPanel filePath={FILE} />);
    const btn = screen.getByRole("button", { name: /export review summary/i });

    // Fire two clicks back-to-back. Token increments on each.
    fireEvent.click(btn);
    fireEvent.click(btn);

    // Resolve SECOND first (with rejection) → status should be "Export failed".
    rejectSecond(new Error("boom"));
    expect(await screen.findByText(/export failed/i)).toBeInTheDocument();

    // Now finish the slow FIRST call with success. Without the token guard,
    // this would flip the status back to "Exported to clipboard". With the
    // guard, the stale resolution is dropped and "Export failed" persists.
    resolveFirst("# first");
    // Flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText(/export failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/exported to clipboard/i)).toBeNull();

    // B4 — the stale first export's markdown must NEVER reach the clipboard.
    // The second export rejected (no markdown to write). Therefore
    // `clipboard.writeText` must not have been called at all in this scenario.
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});


//  Iter 9 F3  filter & search 

describe("CommentsPanel  filter & search (iter 9 F3)", () => {
  it("search filters threads by body text", () => {
    setMockComments([
      makeThread(makeComment("a", "alpha first", { line: 1, matchedLineNumber: 1 })),
      makeThread(makeComment("b", "beta second", { line: 2, matchedLineNumber: 2 })),
      makeThread(makeComment("c", "gamma third", { line: 3, matchedLineNumber: 3 })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    const searchBox = screen.getByLabelText("Search comments");
    fireEvent.change(searchBox, { target: { value: "alpha" } });

    expect(screen.getByText("alpha first")).toBeInTheDocument();
    expect(screen.queryByText("beta second")).not.toBeInTheDocument();
    expect(screen.queryByText("gamma third")).not.toBeInTheDocument();

    // B1.3 — case-insensitive lock: uppercase needle matches lowercase body.
    fireEvent.change(searchBox, { target: { value: "ALPHA" } });
    expect(screen.getByText("alpha first")).toBeInTheDocument();
  });

  it("severity chip narrows list to matching threads", () => {
    setMockComments([
      makeThread(makeComment("h1", "high one", { line: 1, matchedLineNumber: 1, severity: "high" })),
      makeThread(makeComment("m1", "medium one", { line: 2, matchedLineNumber: 2, severity: "medium" })),
      makeThread(makeComment("h2", "high two", { line: 3, matchedLineNumber: 3, severity: "high" })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByRole("button", { name: /severity high/i }));

    expect(screen.getByText("high one")).toBeInTheDocument();
    expect(screen.getByText("high two")).toBeInTheDocument();
    expect(screen.queryByText("medium one")).not.toBeInTheDocument();
  });

  it("workspace-wide toggle includes threads from other files with file path label", () => {
    setMockComments([
      makeThread(makeComment("local", "local note", { line: 1, matchedLineNumber: 1 })),
    ]);
    mockUseWorkspaceComments.mockReturnValue({
      [FILE]: [makeThread(makeComment("local", "local note", { line: 1, matchedLineNumber: 1 }))],
      "/docs/other.md": [makeThread(makeComment("ext", "external note", { line: 7, matchedLineNumber: 7 }))],
    });
    useStore.setState({ root: "/docs" });

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.queryByText("external note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show all files"));

    expect(screen.getByText("external note")).toBeInTheDocument();
    expect(screen.getByText("other.md")).toBeInTheDocument();
  });

  it("showResolved=false hides fully-resolved threads (existing behavior preserved)", () => {
    setMockComments([
      makeThread(makeComment("u", "unresolved", { line: 1, matchedLineNumber: 1 })),
      makeThread(makeComment("r", "all resolved", { line: 2, matchedLineNumber: 2, resolved: true })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    expect(screen.getByText("unresolved")).toBeInTheDocument();
    expect(screen.queryByText("all resolved")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show resolved/i));
    expect(screen.getByText("all resolved")).toBeInTheDocument();
  });

  // B1.3 — toggling a severity chip on then off returns to "no severity
  // filter" (empty Set), which is equivalent to "all toggled off". Both
  // variants must show every thread.
  it("clicking high chip on then off restores all threads", () => {
    setMockComments([
      makeThread(makeComment("h", "high one", { line: 1, matchedLineNumber: 1, severity: "high" })),
      makeThread(makeComment("l", "low one", { line: 2, matchedLineNumber: 2, severity: "low" })),
    ]);

    render(<CommentsPanel filePath={FILE} />);
    const highChip = screen.getByRole("button", { name: /severity high/i });

    fireEvent.click(highChip);
    expect(screen.queryByText("low one")).not.toBeInTheDocument();

    fireEvent.click(highChip);
    expect(screen.getByText("high one")).toBeInTheDocument();
    expect(screen.getByText("low one")).toBeInTheDocument();
  });

  // B1.3 — cross-file click navigation. Iter 10 Group B replaced the rAF
  // hack with a `pendingScrollTarget` store field consumed by the destination
  // viewer's `useScrollToLine` on mount. The panel now queues the target
  // and opens the file; `setActiveTab` is no longer called explicitly
  // (`openFile` already activates the tab); `requestAnimationFrame` is no
  // longer used as a delivery vehicle.
  it("clicking a cross-file row queues pendingScrollTarget + calls openFile + setFocusedThread (no rAF)", () => {
    const openFile = vi.fn();
    const setFocusedThread = vi.fn();
    const setPendingScrollTarget = vi.fn();
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    useStore.setState({
      openFile,
      setFocusedThread,
      setPendingScrollTarget,
      root: "/docs",
    } as Partial<ReturnType<typeof useStore.getState>>);

    setMockComments([]);
    mockUseWorkspaceComments.mockReturnValue({
      "/docs/other.md": [
        makeThread(makeComment("ext", "external note", { line: 7, matchedLineNumber: 7 })),
      ],
    });

    render(<CommentsPanel filePath={FILE} />);
    fireEvent.click(screen.getByLabelText("Show all files"));

    fireEvent.click(screen.getByText("external note").closest(".comment-panel-item")!);

    expect(setPendingScrollTarget).toHaveBeenCalledWith({
      filePath: "/docs/other.md",
      line: 7,
      commentId: "ext",
    });
    expect(openFile).toHaveBeenCalledWith("/docs/other.md");
    expect(setFocusedThread).toHaveBeenCalledWith("ext");
    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });
});
