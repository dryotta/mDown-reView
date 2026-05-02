import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import { useFilteredComments } from "@/lib/vm/useFilteredComments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { CommentThread } from "./CommentThread";
import { CommentInput } from "./CommentInput";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import { deriveAnchor } from "@/lib/anchor-derive";
import { error as logError, warn as logWarn } from "@/logger";
import {
  assertNeverFlashKind,
  buildFlashDetail,
  emitCommentFlash,
  flashElement,
  onCommentFlash,
} from "@/lib/comment-flash";
import type { CommentAnchor, MatchedComment } from "@/lib/tauri-commands";
import type { CommentError } from "@/lib/bindings";
import "@/styles/comments.css";

/**
 * Narrow an unknown rejection to the typed `CommentError` discriminated
 * union (issue #338 / Wave-2). Comment IPCs unwrap their `Result<T, E>`
 * via `tauri-commands.unwrap`, which re-throws typed errors verbatim —
 * so the catch handler receives the raw `{ kind, ... }` shape.
 *
 * Legacy string-based rejections (e.g. `new Error("path not in workspace")`)
 * still fall through to the existing error-banner path; this guard
 * deliberately rejects them so the typed-error self-heal only fires
 * for the canonical wire shape.
 */
function isCommentError(err: unknown): err is CommentError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    typeof (err as { kind: unknown }).kind === "string"
  );
}

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
  /**
   * Surfaces failures from `addComment(..., { kind: "file" })` so a silent
   * IPC rejection (e.g. `path not in workspace`) doesn't leave the user
   * thinking their comment saved. The banner is dismissable and clears
   * automatically on the next successful Save. Rust-side rejections also
   * land in the unified log via `tracing::warn!`, so this is the
   * user-facing half of the chokepoint diagnostic.
   */
  const [fileLevelError, setFileLevelError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  // Line-anchored composer requests: every entry point (selection toolbar,
  // source-view gutter `+`, markdown gutter click on empty block,
  // Ctrl/Cmd+Shift+M) flows through `requestLineCompose` so the panel is
  // the single mount point for new comments. Mirror the pending request
  // into local state, then clear it from the store on consumption.
  const pendingLineCompose = useStore((s) => s.pendingLineCompose);
  const [activeLineCompose, setActiveLineCompose] = useState<{
    anchor: CommentAnchor;
    draftKey: string;
  } | null>(null);
  useEffect(() => {
    if (pendingLineCompose && pendingLineCompose.filePath === filePath) {
      const anchor = pendingLineCompose.anchor as CommentAnchor;
      const draftKey =
        pendingLineCompose.draftKey ??
        `${filePath}::new::${fingerprintAnchor({ kind: "line", ...anchor })}`;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveLineCompose({ anchor, draftKey });
      useStore.getState().clearLineCompose();
    }
  }, [pendingLineCompose, filePath]);

  // B2 (iter 9 forward-fix): the rendered list comes from
  // `useFilteredComments`; the panel header only needs the unresolved /
  // resolved counts of the *active file*, not a sorted thread array.
  const unresolvedCount = useMemo(
    () => threads.reduce((n, t) => n + (t.root.resolved ? 0 : 1), 0),
    [threads]
  );
  const resolvedCount = threads.length - unresolvedCount;

  const filters = useMemo(() => ({ showResolved }), [showResolved]);
  const displayed = useFilteredComments(filePath || null, filters);
  const openFile = useStore((s) => s.openFile);
  const setFocusedThread = useStore((s) => s.setFocusedThread);
  const setPendingScrollTarget = useStore((s) => s.setPendingScrollTarget);

  const handleClick = useCallback(
    (comment: MatchedComment, threadFilePath: string) => {
      const line = comment.matchedLineNumber ?? comment.line ?? 1;
      setFocusedThread(comment.id);
      const flashDetail = buildFlashDetail(comment, threadFilePath);
      if (threadFilePath !== filePath) {
        // Iter 10 Group B — queue the scroll target BEFORE opening the file
        // so the destination viewer drains it on mount via
        // `useScrollToLine`'s `consumePendingScrollTarget(filePath)`. This
        // replaces the iter 9 rAF×2 + setTimeout(0) hack and is robust to
        // cold-loading viewers + rapid clicks (nonce supersedes earlier
        // queued targets, consume-by-filePath rejects mismatches).
        setPendingScrollTarget({ filePath: threadFilePath, line, commentId: comment.id });
        openFile(threadFilePath);
        // The destination viewer will pick up the flash on mount via the
        // `comment-flash` event we fire here — same-file flow does the
        // same dispatch below.
        emitCommentFlash(flashDetail);
        return;
      }
      onScrollToLine?.(line);
      window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line } }));
      emitCommentFlash(flashDetail);
    },
    [onScrollToLine, filePath, openFile, setFocusedThread, setPendingScrollTarget]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, comment: MatchedComment, threadFilePath: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick(comment, threadFilePath);
      }
    },
    [handleClick]
  );

  // Cross-surface flash listener for panel rows. Switches on the
  // discriminator (iter 3 of #280):
  //   - file / unmatched: look up the row by `data-comment-id` (commentId
  //     from the detail). Body has no DOM target for these kinds.
  //   - line:  match by `data-comment-line` (existing single-line lookup).
  //   - range: fan out from `line` to `endLine` inclusive, flashing each
  //     row whose `data-comment-line` lands inside the span.
  useEffect(() => {
    return onCommentFlash((detail) => {
      const root = bodyRef.current;
      if (!root) return;
      switch (detail.kind) {
        case "file":
        case "unmatched": {
          const el = root.querySelector<HTMLElement>(
            `.comment-panel-item[data-comment-id="${CSS.escape(detail.commentId)}"]`
          );
          if (el) flashElement(el);
          return;
        }
        case "line":
        case "range": {
          const startLine = detail.line;
          const endLine = detail.kind === "range" ? detail.endLine : detail.line;
          const items = root.querySelectorAll<HTMLElement>(
            `.comment-panel-item[data-comment-file-path="${CSS.escape(detail.filePath)}"]`
          );
          items.forEach((el) => {
            const lineAttr = el.getAttribute("data-comment-line");
            if (!lineAttr) return;
            const ln = Number(lineAttr);
            if (ln >= startLine && ln <= endLine) flashElement(el);
          });
          return;
        }
        default:
          assertNeverFlashKind(detail);
      }
    });
  }, []);

  const handleSaveFileLevel = useCallback(
    (text: string) => {
      // File-anchored comment — no line gutter, no selected text. We let the
      // VM hook chokepoint funnel the discriminated `{ kind: "file" }` anchor
      // through the existing `add_comment` IPC.
      setFileLevelError(null);
      // Optimistically close the input so the UI stays responsive — failures
      // surface in the persistent error banner below (unblocking the input
      // for retry without forcing the user to wait on the IPC round-trip).
      setShowFileLevelInput(false);
      void addComment(filePath, text, { kind: "file" }).catch((e) => {
        // Issue #338 / Wave-2 — typed CommentError self-heal. The IPC
        // now returns a discriminated `{ kind: "outside-workspace", path }`
        // instead of a string-match prose, so we branch on the canonical
        // wire shape rather than `msg.includes("path not in workspace")`.
        // Legacy string-based rejections still fall through to the
        // existing error-banner path below for backwards compatibility.
        if (isCommentError(e) && e.kind === "outside-workspace") {
          // Mark the tab read-only so subsequent comment-input mounts
          // are pre-disabled — the user no longer needs to retry to
          // discover the workspace boundary. The eager `path_classify`
          // at openFile time normally sets this; the self-heal handles
          // the race where the workspace allowlist changed between the
          // open and the write attempt.
          useStore.getState().setTabReadOnly(filePath, true);
          void logWarn(
            `[CommentsPanel] outside-workspace blocked; tab ${filePath} marked read-only`
          );
          setFileLevelError(
            "Could not save comment: this file is outside the workspace and is read-only."
          );
          return;
        }
        // The most common cause used to be `path not in workspace` — surface it
        // to the user (not just the log) so they don't lose the comment
        // silently. The Rust side also logs via `tracing::warn!` to the
        // unified log so future "comment didn't save" reports are
        // diagnosable from `%LocalAppData%\com.mdownreview.desktop\logs\`.
        const msg = e instanceof Error ? e.message : String(e);
        void logError(`[CommentsPanel] file-level addComment failed for ${filePath}: ${msg}`);
        setFileLevelError(`Could not save comment: ${msg}`);
      });
    },
    [addComment, filePath]
  );

  const handleSaveLineCompose = useCallback(
    (text: string) => {
      if (!activeLineCompose) return;
      const anchor = activeLineCompose.anchor;
      void addComment(filePath, text, anchor).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void logError(`[CommentsPanel] line-anchored addComment failed for ${filePath}: ${msg}`);
      });
      setActiveLineCompose(null);
    },
    [addComment, filePath, activeLineCompose]
  );

  const canCommentOnFile = filePath.length > 0;

  // C3 (iter 6 Group A) — focus halo is now CSS-only via `:focus-within`
  // on `.comment-panel-item`. See `src/styles/comments.css`.

  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments ({unresolvedCount})</span>
        <button
          className="comment-btn comment-btn-add-file"
          onClick={() => setShowFileLevelInput((v) => !v)}
          disabled={!canCommentOnFile}
          title="Comment on file"
          aria-label="Comment on file"
        >
          +
        </button>
        <button className="comment-btn" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
        </button>
      </div>
      <div className="comments-panel-body" ref={bodyRef}>
        {fileLevelError && (
          <div className="comments-panel-error" role="alert" aria-live="polite">
            <span className="comments-panel-error-text">{fileLevelError}</span>
            <button
              className="comments-panel-error-dismiss"
              onClick={() => setFileLevelError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        {showFileLevelInput && canCommentOnFile && (
          <div className="comment-panel-file-input">
            <CommentInput
              onSave={handleSaveFileLevel}
              onClose={() => {
                setShowFileLevelInput(false);
                setFileLevelError(null);
              }}
              placeholder="Comment on this file… (Ctrl+Enter to save, Escape to cancel)"
              draftKey={`${filePath}::new::${fingerprintAnchor({ kind: "file" })}`}
            />
          </div>
        )}
        {activeLineCompose && (
          <div className="comment-panel-line-input">
            <div className="comment-panel-line-input-anchor">
              Line {activeLineCompose.anchor.line}
              {activeLineCompose.anchor.selected_text && (
                <span className="comment-panel-line-input-snippet">
                  {" — "}
                  {activeLineCompose.anchor.selected_text}
                </span>
              )}
            </div>
            <CommentInput
              onSave={handleSaveLineCompose}
              onClose={() => setActiveLineCompose(null)}
              placeholder="Add a comment… (Ctrl+Enter to save, Escape to cancel)"
              draftKey={activeLineCompose.draftKey}
            />
          </div>
        )}
        {displayed.length === 0 ? (
          <div className="comments-empty">No comments yet</div>
        ) : (
          displayed.map(({ thread, filePath: tp }) => {
            const anchor = deriveAnchor(thread.root);
            const isFileLevel = anchor.kind === "file";
            const matchedLine = thread.root.matchedLineNumber ?? thread.root.line ?? null;
            return (
              <div
                key={`${tp}::${thread.root.id}`}
                className="comment-panel-item"
                role="button"
                tabIndex={0}
                data-comment-file-path={tp}
                data-comment-line={matchedLine ?? ""}
                data-comment-id={thread.root.id}
                onClick={() => handleClick(thread.root, tp)}
                onKeyDown={(e) => handleKeyDown(e, thread.root, tp)}
              >
                <div className="comment-panel-item-line">
                  {isFileLevel ? (
                    <span
                      className="comment-panel-file-pill"
                      title="File-level comment (anchored to the whole file)"
                      aria-label="File-level comment"
                    >
                      📄 File
                    </span>
                  ) : (
                    <>Line {matchedLine ?? "?"}</>
                  )}
                  {thread.root.isOrphaned && (
                    <span className="comment-orphaned-icon" title="Orphaned">
                      ⚠
                    </span>
                  )}
                </div>
                <CommentThread rootComment={thread.root} replies={thread.replies} filePath={tp} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
