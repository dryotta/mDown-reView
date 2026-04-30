import { memo } from "react";
import { CommentMarker } from "@/components/comments/CommentMarker";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

export interface SourceLineProps {
  idx: number;
  lineNum: number;
  filePath: string;
  /** Pre-rendered HTML for the line content (search-highlighted, syntax-highlighted, or escaped). */
  contentHtml: string;
  isSelectionActive: boolean;
  foldRegion: FoldRegion | undefined;
  isCollapsed: boolean;
  lineThreads: CommentThread[];
  /**
   * When false, the per-line "+" add-comment button is hidden. Used for
   * sidecar files where the user cannot add comments. Defaults to true so
   * callers that don't pass this prop keep the previous behaviour.
   */
  commentable?: boolean;
  onToggleFold: (lineNum: number) => void;
  /**
   * Click handler for the gutter `+` button (line has no comments yet).
   * Should seed a panel composer for this line — the source view never
   * mounts an inline composer.
   */
  onAddCommentClick: (lineNum: number) => void;
  /**
   * Click handler for the bubble marker (line has unresolved comments).
   * Should fire the cross-surface flash so the panel scrolls + flashes
   * the matching threads and the line itself flashes too.
   */
  onMarkerClick: (lineNum: number) => void;
}

/**
 * Renders a single line of source code with its gutter (add-comment button
 * OR speech-bubble marker, fold toggle, line number), the line content,
 * and an optional collapsed-fold placeholder beneath it.
 *
 * Pure presentation: all per-line state is passed in via props; the parent
 * `SourceView` owns iteration, fold-skip logic, and all data-fetching
 * hooks. Inline comments + composers were removed in the panel-only
 * authoring refactor — every authoring entry point seeds a composer in
 * the right-side `CommentsPanel` instead.
 */
function SourceLineImpl({
  idx,
  lineNum,
  contentHtml,
  isSelectionActive,
  foldRegion,
  isCollapsed,
  lineThreads,
  commentable = true,
  onToggleFold,
  onAddCommentClick,
  onMarkerClick,
}: SourceLineProps) {
  const unresolvedCount = lineThreads.reduce((acc, t) => {
    let count = t.root.resolved ? 0 : 1;
    count += t.replies.filter((r) => !r.resolved).length;
    return acc + count;
  }, 0);
  const hasMarker = unresolvedCount > 0;

  return (
    <>
      <div
        className={`source-line${isSelectionActive ? " selection-active" : ""}`}
        data-line-idx={idx}
        data-source-line={lineNum}
      >
        <span className="source-line-gutter">
          <span className="source-line-comment-zone">
            {hasMarker ? (
              <CommentMarker count={unresolvedCount} onClick={() => onMarkerClick(lineNum)} />
            ) : (
              commentable && (
                <button
                  className="comment-plus-btn"
                  aria-label="Add comment"
                  onClick={() => onAddCommentClick(lineNum)}
                >
                  +
                </button>
              )
            )}
          </span>
          <span className="source-line-fold-zone">
            {foldRegion && (
              <button
                className="source-line-fold-toggle"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
                onClick={() => onToggleFold(lineNum)}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            )}
          </span>
          <span className="source-line-number-zone">{lineNum}</span>
        </span>
        <span className="source-line-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
      </div>
      {isCollapsed && foldRegion && (
        <div className="source-fold-placeholder" onClick={() => onToggleFold(lineNum)}>
          ⋯ {foldRegion.endLine - lineNum - 1} lines hidden
        </div>
      )}
    </>
  );
}

export const SourceLine = memo(SourceLineImpl);
