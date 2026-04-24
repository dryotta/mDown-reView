import { memo } from "react";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

export interface SourceLineProps {
  idx: number;
  lineNum: number;
  line: string;
  filePath: string;
  /** Pre-rendered HTML for the line content (search-highlighted, syntax-highlighted, or escaped). */
  contentHtml: string;
  isSelectionActive: boolean;
  foldRegion: FoldRegion | undefined;
  isCollapsed: boolean;
  lineThreads: CommentThread[];
  isCommenting: boolean;
  isExpanded: boolean;
  onToggleFold: (lineNum: number) => void;
  onCommentButtonClick: (lineNum: number) => void;
  onCloseInput: () => void;
  onRequestInput: (lineNum: number) => void;
  onSaveComment?: (text: string) => void;
}

/**
 * Renders a single line of source code with its gutter (add-comment button,
 * fold toggle, line number), the line content, an optional inline comment
 * margin, and an optional collapsed-fold placeholder beneath it.
 *
 * Pure presentation: all per-line state is passed in via props; the parent
 * `SourceView` owns iteration, fold-skip logic, and all data-fetching hooks.
 */
function SourceLineImpl({
  idx,
  lineNum,
  line,
  filePath,
  contentHtml,
  isSelectionActive,
  foldRegion,
  isCollapsed,
  lineThreads,
  isCommenting,
  isExpanded,
  onToggleFold,
  onCommentButtonClick,
  onCloseInput,
  onRequestInput,
  onSaveComment,
}: SourceLineProps) {
  const showMargin = isCommenting || isExpanded || lineThreads.length > 0;

  return (
    <>
      <div
        className={`source-line${isSelectionActive ? " selection-active" : ""}`}
        data-line-idx={idx}
      >
        <span className="source-line-gutter">
          <span className="source-line-comment-zone">
            <button
              className="comment-plus-btn"
              aria-label="Add comment"
              onClick={() => onCommentButtonClick(lineNum)}
            >
              +
            </button>
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
        <span
          className="source-line-content"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>
      {showMargin && (
        <LineCommentMargin
          filePath={filePath}
          lineNumber={lineNum}
          lineText={line}
          threads={lineThreads}
          showInput={isCommenting}
          forceExpanded={isExpanded}
          onCloseInput={onCloseInput}
          onRequestInput={() => onRequestInput(lineNum)}
          onSaveComment={onSaveComment}
        />
      )}
      {isCollapsed && foldRegion && (
        <div
          className="source-fold-placeholder"
          onClick={() => onToggleFold(lineNum)}
        >
          ⋯ {foldRegion.endLine - lineNum - 1} lines hidden
        </div>
      )}
    </>
  );
}

export const SourceLine = memo(SourceLineImpl);
