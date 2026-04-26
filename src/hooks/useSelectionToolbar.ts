import { useState, useCallback } from "react";
import { computeAnchorHash } from "@/lib/tauri-commands";
import { truncateSelectedText } from "@/lib/comment-utils";
import { useStore } from "@/store";

interface SelectionState {
  position: { top: number; left: number };
  lineNumber: number;
  selectedText: string;
  startOffset: number;
  endLine: number;
  endOffset: number;
}

interface PendingAnchor {
  line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  selected_text: string;
  selected_text_hash?: string;
}

export function useSelectionToolbar(lineAttribute = "data-line-idx", lineOffset = 1) {
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionState | null>(null);
  const [pendingSelectionAnchor, setPendingSelectionAnchor] = useState<PendingAnchor | null>(null);
  const [highlightedSelectionLines, setHighlightedSelectionLines] = useState<Set<number>>(new Set());

  const handleMouseUp = () => {
    // Move-anchor mode short-circuits the selection composer. The
    // MarkdownViewer / SourceView click handlers commit the move; we must
    // not pop the selection toolbar in this mode.
    if (useStore.getState().moveAnchorTarget !== null) {
      setSelectionToolbar(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelectionToolbar(null); return; }
    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();
    if (!selectedText.trim()) { setSelectionToolbar(null); return; }

    const startEl = range.startContainer.parentElement?.closest(`[${lineAttribute}]`);
    const endEl = range.endContainer.parentElement?.closest(`[${lineAttribute}]`);
    if (!startEl || !endEl) { setSelectionToolbar(null); return; }

    const startIdx = Number(startEl.getAttribute(lineAttribute));
    const endIdx = Number(endEl.getAttribute(lineAttribute));

    // Use last client rect for positioning near selection end. When
    // `getClientRects()` returns nothing (Range collapsed-at-boundary,
    // selection spanning hidden nodes, or some odd shadow-DOM cases),
    // fall back to a temporary zero-width range placed at the selection's
    // end point so we can still read a usable caret rect.
    const rects = range.getClientRects();
    let lastRect: DOMRect | null =
      rects.length > 0 ? (rects[rects.length - 1] as DOMRect) : null;
    if (!lastRect) {
      try {
        const caret = document.createRange();
        caret.setStart(range.endContainer, range.endOffset);
        caret.setEnd(range.endContainer, range.endOffset);
        const caretRect = caret.getBoundingClientRect();
        // Some browsers return an all-zero rect for an empty range — only
        // accept the fallback when it carries usable coordinates.
        if (caretRect.top !== 0 || caretRect.left !== 0 || caretRect.bottom !== 0) {
          lastRect = caretRect;
        }
      } catch {
        // Range construction can throw for detached nodes; keep lastRect null.
      }
    }
    if (!lastRect) {
      lastRect = range.getBoundingClientRect();
    }

    // Position above selection, clamped to viewport
    const toolbarHeight = 36;
    const toolbarWidth = 120;
    let top = lastRect.top - toolbarHeight - 4;
    let left = lastRect.left + (lastRect.width / 2) - (toolbarWidth / 2);

    // Flip below if no room above
    if (top < 4) {
      top = lastRect.bottom + 4;
    }

    // Clamp to viewport bounds — top floor first, then bottom edge so the
    // toolbar can't be rendered off-screen when a selection ends near the
    // bottom of the window.
    top = Math.max(4, top);
    top = Math.min(top, window.innerHeight - toolbarHeight - 4);

    // Clamp horizontal
    left = Math.max(4, Math.min(left, window.innerWidth - toolbarWidth - 4));

    setSelectionToolbar({
      position: { top, left },
      lineNumber: startIdx + lineOffset,
      selectedText,
      startOffset: range.startOffset,
      endLine: endIdx + lineOffset,
      endOffset: range.endOffset,
    });
  };

  const handleAddSelectionComment = async (setCommentingLine: (line: number) => void) => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;

    const truncated = truncateSelectedText(selectedText);
    const hash = await computeAnchorHash(truncated);

    setPendingSelectionAnchor({
      line: lineNumber,
      end_line: endLine,
      start_column: startOffset,
      end_column: endOffset,
      selected_text: truncated,
      selected_text_hash: hash,
    });

    // Highlight selected lines
    const startLine = lineNumber;
    const endLineNum = endLine ?? lineNumber;
    const highlighted = new Set<number>();
    for (let i = startLine; i <= endLineNum; i++) highlighted.add(i);
    setHighlightedSelectionLines(highlighted);

    setSelectionToolbar(null);
    setCommentingLine(lineNumber);
  };

  const clearSelection = useCallback(() => {
    setPendingSelectionAnchor(null);
    setHighlightedSelectionLines(new Set());
  }, []);

  return {
    selectionToolbar,
    setSelectionToolbar,
    pendingSelectionAnchor,
    highlightedSelectionLines,
    handleMouseUp,
    handleAddSelectionComment,
    clearSelection,
  };
}
