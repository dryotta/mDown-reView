import React from "react";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import {
  CommentContextMenu,
  type CommentContextMenuAction,
} from "@/components/comments/CommentContextMenu";
import { MdCommentPopover } from "./CommentableBlocks";
import type {
  CommentThread as CommentThreadType,
  CommentAnchor,
} from "@/lib/tauri-commands";

export interface SelectionToolbarState {
  position: { top: number; left: number };
}

export interface CommentContextMenuState {
  open: boolean;
  x: number;
  y: number;
  hasSelection: boolean;
  hasLine: boolean;
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

  // F6 — right-click context menu. Optional; viewers that don't wire it
  // pass nothing and the menu never renders.
  contextMenu?: CommentContextMenuState;
  onContextMenuAction?: (a: CommentContextMenuAction) => void;
  onContextMenuClose?: () => void;
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
  contextMenu,
  onContextMenuAction,
  onContextMenuClose,
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
      {contextMenu && onContextMenuAction && onContextMenuClose && (
        <CommentContextMenu
          open={contextMenu.open}
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          hasLine={contextMenu.hasLine}
          onAction={onContextMenuAction}
          onClose={onContextMenuClose}
        />
      )}
    </>
  );
}
