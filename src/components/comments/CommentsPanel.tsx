import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import { useFilteredComments, type SeverityFilter } from "@/lib/vm/useFilteredComments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { CommentThread } from "./CommentThread";
import { CommentInput } from "./CommentInput";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import { exportReviewSummary, type MatchedComment } from "@/lib/tauri-commands";
import { error } from "@/logger";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  onScrollToLine?: (lineNumber: number) => void;
}

const SEVERITY_CHIPS: SeverityFilter[] = ["none", "low", "medium", "high"];

export function CommentsPanel({ filePath, onScrollToLine }: Props) {
  // `useComments` is still called for the unresolved/resolved counters in the
  // header; the displayed list now comes from `useFilteredComments`.
  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();
  const [showResolved, setShowResolved] = useState(false);
  const [showFileLevelInput, setShowFileLevelInput] = useState(false);
  const [search, setSearch] = useState("");
  const [severities, setSeverities] = useState<Set<SeverityFilter>>(() => new Set());
  const [workspaceWide, setWorkspaceWide] = useState(false);
  // Iter 6 F2 — transient "Exported to clipboard" status. Cleared after a
  // short timer so the header doesn't accumulate stale chrome.
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const root = useStore((s) => s.root);

  // Iter 5 Group B — single-field selector (architecture rule 9). When this
  // matches our `filePath`, the toolbar's "Comment on file" button has
  // requested us to auto-open the inline file-level input. We mirror the
  // request into a local toggle so the input stays open after the flag
  // is cleared, then immediately clear the flag (via `useStore.getState()`,
  // not closure capture) so the request is consumed exactly once.
  const pendingFileLevelInputFor = useStore((s) => s.pendingFileLevelInputFor);
  useEffect(() => {
    if (pendingFileLevelInputFor && pendingFileLevelInputFor === filePath) {
      // Reacting to an external store flag (set by a sibling viewer's
      // toolbar) is the legitimate "subscribe for updates from some
      // external system" pattern — see react-hooks/set-state-in-effect docs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowFileLevelInput(true);
      useStore.getState().clearFileLevelInput();
    }
  }, [pendingFileLevelInputFor, filePath]);

  // B2 (iter 9 forward-fix): the rendered list comes from
  // `useFilteredComments`; the panel header only needs the unresolved /
  // resolved counts of the *active file*, not a sorted thread array.
  const unresolvedCount = useMemo(
    () => threads.reduce((n, t) => n + (t.root.resolved ? 0 : 1), 0),
    [threads],
  );
  const resolvedCount = threads.length - unresolvedCount;

  const filters = useMemo(
    () => ({ search, severities, showResolved, workspaceWide }),
    [search, severities, showResolved, workspaceWide],
  );
  const displayed = useFilteredComments(filePath || null, filters);
  const openFile = useStore((s) => s.openFile);
  const setFocusedThread = useStore((s) => s.setFocusedThread);
  const setPendingScrollTarget = useStore((s) => s.setPendingScrollTarget);

  const handleClick = useCallback((comment: MatchedComment, threadFilePath: string) => {
    const line = comment.matchedLineNumber ?? comment.line ?? 1;
    setFocusedThread(comment.id);
    if (threadFilePath !== filePath) {
      // Iter 10 Group B — queue the scroll target BEFORE opening the file
      // so the destination viewer drains it on mount via
      // `useScrollToLine`'s `consumePendingScrollTarget(filePath)`. This
      // replaces the iter 9 rAF×2 + setTimeout(0) hack and is robust to
      // cold-loading viewers + rapid clicks (nonce supersedes earlier
      // queued targets, consume-by-filePath rejects mismatches).
      setPendingScrollTarget({ filePath: threadFilePath, line, commentId: comment.id });
      openFile(threadFilePath);
      return;
    }
    onScrollToLine?.(line);
    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line } }));
  }, [onScrollToLine, filePath, openFile, setFocusedThread, setPendingScrollTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, comment: MatchedComment, threadFilePath: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(comment, threadFilePath);
    }
  }, [handleClick]);

  const toggleSeverity = useCallback((sev: SeverityFilter) => {
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }, []);

  const relativePath = useCallback((p: string) => {
    if (!root) return p;
    return p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, "") : p;
  }, [root]);

  const handleSaveFileLevel = useCallback((text: string) => {
    // File-anchored comment — no line gutter, no selected text. We let the
    // VM hook chokepoint funnel the discriminated `{ kind: "file" }` anchor
    // through the existing `add_comment` IPC.
    addComment(filePath, text, { kind: "file" }).catch(() => {});
    setShowFileLevelInput(false);
  }, [addComment, filePath]);

  const canCommentOnFile = filePath.length > 0;

  // Iter 6 F2 — workspace-wide review-summary export. Calls the existing
  // `export_review_summary` IPC, copies the rendered markdown to the clipboard,
  // and shows a transient status. Falls back to `filePath` when no workspace
  // root is open (single-file launches).
  const exportWorkspace = root ?? filePath;
  const canExport = exportWorkspace.length > 0;
  // A3 (iter 7) — race guard. Each click increments the token; only the
  // most-recent in-flight call is allowed to set `exportStatus`. Without
  // this, a slow first click that resolves AFTER a fast second click would
  // overwrite the second click's status with stale chrome.
  const exportTokenRef = useRef(0);
  const handleExport = useCallback(async () => {
    if (!canExport) return;
    const token = ++exportTokenRef.current;
    try {
      const markdown = await exportReviewSummary(exportWorkspace);
      // B4 (iter 7 forward-fix) — check the token BEFORE writing to the
      // clipboard. Otherwise a slow first export can land its stale
      // markdown on the clipboard after a faster second export already
      // wrote the user's intended content.
      if (token !== exportTokenRef.current) return;
      await navigator.clipboard.writeText(markdown);
      if (token === exportTokenRef.current) {
        setExportStatus("Exported to clipboard");
      }
    } catch (e) {
      error(`[CommentsPanel] export failed: ${e}`);
      if (token === exportTokenRef.current) {
        setExportStatus("Export failed");
      }
    }
  }, [exportWorkspace, canExport]);

  useEffect(() => {
    if (!exportStatus) return;
    const id = window.setTimeout(() => setExportStatus(null), 2000);
    return () => window.clearTimeout(id);
  }, [exportStatus]);

  // C3 (iter 6 Group A) — focus halo is now CSS-only via `:focus-within`
  // on `.comment-panel-item`. See `src/styles/comments.css`.

  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments ({unresolvedCount})</span>
        <button
          className="comment-btn comment-btn-add-file"
          onClick={() => setShowFileLevelInput(v => !v)}
          disabled={!canCommentOnFile}
          title="Comment on file"
          aria-label="Comment on file"
        >
          +
        </button>
        <button
          className="comment-btn comment-btn-export"
          onClick={handleExport}
          disabled={!canExport}
          title="Export review summary to clipboard"
          aria-label="Export review summary"
        >
          Export
        </button>
        <button className="comment-btn" onClick={() => setShowResolved(v => !v)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
        </button>
        {exportStatus && (
          <span className="comments-panel-status" role="status" aria-live="polite">
            {exportStatus}
          </span>
        )}
      </div>
      <div className="comments-panel-filters">
        <input
          type="search"
          className="comments-filter-search"
          placeholder="Search comments…"
          aria-label="Search comments"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="comments-filter-chips" role="group" aria-label="Filter by severity">
          {SEVERITY_CHIPS.map((sev) => (
            <button
              key={sev}
              type="button"
              className={`comments-filter-chip comments-filter-chip--${sev}`}
              aria-pressed={severities.has(sev)}
              aria-label={`Severity ${sev}`}
              onClick={() => toggleSeverity(sev)}
            >
              {sev}
            </button>
          ))}
        </div>
        <label className="comments-filter-workspace">
          <input
            type="checkbox"
            checked={workspaceWide}
            onChange={(e) => setWorkspaceWide(e.target.checked)}
            aria-label="Show all files"
          />
          Show all files
        </label>
      </div>
      <div className="comments-panel-body">
        {showFileLevelInput && canCommentOnFile && (
          <div className="comment-panel-file-input">
            <CommentInput
              onSave={handleSaveFileLevel}
              onClose={() => setShowFileLevelInput(false)}
              placeholder="Comment on this file… (Ctrl+Enter to save, Escape to cancel)"
              draftKey={`${filePath}::new::${fingerprintAnchor({ kind: "file" })}`}
            />
          </div>
        )}
        {displayed.length === 0 ? (
          <div className="comments-empty">No comments yet</div>
        ) : (
          displayed.map(({ thread, filePath: tp }) => (
            <div
              key={`${tp}::${thread.root.id}`}
              className="comment-panel-item"
              role="button"
              tabIndex={0}
              onClick={() => handleClick(thread.root, tp)}
              onKeyDown={(e) => handleKeyDown(e, thread.root, tp)}
            >
              {workspaceWide && tp !== filePath && (
                <div className="comment-panel-item-path" title={tp}>{relativePath(tp)}</div>
              )}
              <div className="comment-panel-item-line">
                Line {thread.root.matchedLineNumber ?? thread.root.line ?? "?"}
                {thread.root.isOrphaned && <span className="comment-orphaned-icon" title="Orphaned">⚠</span>}
              </div>
              <CommentThread rootComment={thread.root} replies={thread.replies} filePath={tp} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
