import { useState, useMemo, useCallback, useEffect } from "react";
import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import { useFilteredComments } from "@/lib/vm/useFilteredComments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { CommentThread } from "./CommentThread";
import { CommentInput } from "./CommentInput";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import type { MatchedComment } from "@/lib/tauri-commands";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  onScrollToLine?: (lineNumber: number) => void;
}

export function CommentsPanel({ filePath, onScrollToLine }: Props) {
  // `useComments` is still called for the unresolved/resolved counters in the
  // header; the displayed list now comes from `useFilteredComments`.
  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();
  const [showResolved, setShowResolved] = useState(false);
  const [showFileLevelInput, setShowFileLevelInput] = useState(false);

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
    () => ({ showResolved }),
    [showResolved],
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

  const handleSaveFileLevel = useCallback((text: string) => {
    // File-anchored comment — no line gutter, no selected text. We let the
    // VM hook chokepoint funnel the discriminated `{ kind: "file" }` anchor
    // through the existing `add_comment` IPC.
    addComment(filePath, text, { kind: "file" }).catch(() => {});
    setShowFileLevelInput(false);
  }, [addComment, filePath]);

  const canCommentOnFile = filePath.length > 0;

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
        <button className="comment-btn" onClick={() => setShowResolved(v => !v)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
        </button>
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
