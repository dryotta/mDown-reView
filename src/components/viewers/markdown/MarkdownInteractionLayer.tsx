import React from "react";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { MdCommentPopover } from "./CommentableBlocks";
import type {
  CommentThread as CommentThreadType,
  CommentAnchor,
} from "@/lib/tauri-commands";

export interface SelectionToolbarState {
  position: { top: number; left: number };
}

interface Props {
  // Per-line popover state
  expandedLine: number | null;
  commentingLine: number | null;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  threadsByLine: Map<number, CommentThreadType[]>;
  filePath: string;
  lines: string[];
  pendingSelectionAnchor: CommentAnchor | null;
  addComment: (filePath: string, text: string, anchor?: CommentAnchor) => Promise<void>;
  setCommentingLine: (v: number | null) => void;
  setExpandedLine: (v: number | null) => void;
  clearSelection: () => void;

  // Selection toolbar state. The layer only consumes `position` and only ever
  // dismisses the toolbar (sets to null) — typing the setter narrowly here
  // keeps the layer decoupled from the hook's full SelectionState shape.
  selectionToolbar: SelectionToolbarState | null;
  dismissSelectionToolbar: () => void;
  onAddSelectionComment: () => void;
}

/**
 * Composes the MdCommentPopover (per-line "Add comment" affordance, anchored
 * via bodyRef) and the floating SelectionToolbar (fixed-position chip that
 * appears on text selection). Extracted from MarkdownViewer so the parent
 * stays under the LOC budget — both subcomponents are stateless w.r.t. each
 * other and just need the same hook outputs as props.
 */
export function MarkdownInteractionLayer({
  expandedLine,
  commentingLine,
  bodyRef,
  threadsByLine,
  filePath,
  lines,
  pendingSelectionAnchor,
  addComment,
  setCommentingLine,
  setExpandedLine,
  clearSelection,
  selectionToolbar,
  dismissSelectionToolbar,
  onAddSelectionComment,
}: Props) {
  return (
    <>
      {(expandedLine !== null || commentingLine !== null) && (
        <MdCommentPopover
          expandedLine={expandedLine}
          commentingLine={commentingLine}
          bodyRef={bodyRef}
          threadsByLine={threadsByLine}
          filePath={filePath}
          lines={lines}
          pendingSelectionAnchor={pendingSelectionAnchor}
          addComment={addComment}
          setCommentingLine={setCommentingLine}
          setExpandedLine={setExpandedLine}
          clearSelection={clearSelection}
        />
      )}
      {selectionToolbar && (
        <SelectionToolbar
          position={selectionToolbar.position}
          onAddComment={onAddSelectionComment}
          onDismiss={dismissSelectionToolbar}
        />
      )}
    </>
  );
}
