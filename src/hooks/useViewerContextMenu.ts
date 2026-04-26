import { useCallback, useEffect } from "react";
import type React from "react";
import { useContextMenu } from "./useContextMenu";
import { useStore } from "@/store";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { buildCommentLink } from "@/lib/comment-link";
import type { CommentContextMenuAction } from "@/components/comments/CommentContextMenu";

interface Options {
  filePath: string;
  /** Walk up from the right-click target to find the line element and return
   *  its 1-indexed line number, or null if the click site has no line. Each
   *  viewer plugs in its own attribute (`data-source-line` for markdown, or
   *  `data-line-idx` + 1 for source view). */
  resolveLine: (target: HTMLElement) => number | null;
  /** Called when the click site has a non-empty selection. Lets the viewer
   *  prime its SelectionToolbar state so `startSelectionComment` has the
   *  same anchor that the mouseup-driven flow would have produced. */
  primeSelection?: () => void;
  /** Called for the "Comment on selection" action. */
  startSelectionComment?: () => void;
}

interface ContextMenuPayload {
  line: number | null;
  hasSelection: boolean;
}

/** F6 — shared context-menu wiring for commentable viewers. Owns the
 *  `useContextMenu` state, normalizes selection/line detection, registers
 *  the active-viewer opener for keyboard reachability (Shift+F10 /
 *  ContextMenu key — see `useGlobalShortcuts`), and dispatches the three
 *  actions (comment / copy-link / discussed) so each viewer drops to a
 *  thin wiring layer. */
export function useViewerContextMenu(opts: Options): {
  ctxMenu: ReturnType<typeof useContextMenu<ContextMenuPayload>>;
  handleContextMenu: (e: React.MouseEvent) => void;
  handleContextAction: (a: CommentContextMenuAction) => void;
  closeContextMenu: () => void;
} {
  const { filePath, resolveLine, primeSelection, startSelectionComment } = opts;
  const ctxMenu = useContextMenu<ContextMenuPayload>();
  const { addComment } = useCommentActions();

  const detectSelection = (): boolean => {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && !!sel.toString().trim();
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const line = resolveLine(e.target as HTMLElement);
    const hasSelection = detectSelection();
    if (hasSelection) primeSelection?.();
    e.preventDefault();
    ctxMenu.openAt({ clientX: e.clientX, clientY: e.clientY }, { line, hasSelection });
  }, [ctxMenu, resolveLine, primeSelection]);

  // F6 — register self as the active viewer's keyboard-reachable opener.
  // Shift+F10 / ContextMenu key in `useGlobalShortcuts` invoke this with
  // viewport (x, y) it computed from the current selection (or a fallback).
  // Line resolution is best-effort: prefer the focused/selected element's
  // closest line container, else null.
  useEffect(() => {
    const open = (x: number, y: number) => {
      let line: number | null = null;
      const sel = window.getSelection();
      const hasSelection = !!sel && !sel.isCollapsed && !!sel.toString().trim();
      const fromSel = (() => {
        if (!hasSelection || !sel) return null;
        const node = sel.focusNode;
        if (!node) return null;
        return node instanceof HTMLElement ? node : (node.parentElement as HTMLElement | null);
      })();
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const candidate = fromSel ?? focused;
      if (candidate) line = resolveLine(candidate);
      if (hasSelection) primeSelection?.();
      ctxMenu.openAt({ clientX: x, clientY: y }, { line, hasSelection });
    };
    useStore.getState().setActiveViewerContextMenu(open);
    return () => {
      // Clear unconditionally — only one commentable viewer is mounted at a
      // time so cross-viewer overwrite is not a real race.
      useStore.getState().setActiveViewerContextMenu(null);
    };
  }, [ctxMenu, resolveLine, primeSelection]);

  const handleContextAction = useCallback((action: CommentContextMenuAction) => {
    const payload = ctxMenu.state.payload;
    if (!payload) return;
    const { line } = payload;
    if (action === "comment") {
      startSelectionComment?.();
    } else if (action === "copy-link") {
      const link = buildCommentLink({
        filePath,
        line: line ?? undefined,
        workspaceRoot: useStore.getState().root,
      });
      void navigator.clipboard?.writeText?.(link);
    } else if (action === "discussed") {
      if (line != null) {
        void addComment(filePath, "discussed", { kind: "line", line }, undefined, "none");
      }
    }
  }, [ctxMenu.state.payload, filePath, addComment, startSelectionComment]);

  return {
    ctxMenu,
    handleContextMenu,
    handleContextAction,
    closeContextMenu: ctxMenu.close,
  };
}
