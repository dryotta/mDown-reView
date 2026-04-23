import { useState, useCallback } from "react";
import { computeAnchorHash } from "@/lib/tauri-commands";
import { truncateSelectedText } from "@/lib/comment-utils";

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

export function useSelectionToolbar() {
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionState | null>(null);
  const [pendingSelectionAnchor, setPendingSelectionAnchor] = useState<PendingAnchor | null>(null);
  const [highlightedSelectionLines, setHighlightedSelectionLines] = useState<Set<number>>(new Set());

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelectionToolbar(null); return; }
    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();
    if (!selectedText.trim()) { setSelectionToolbar(null); return; }

    const startEl = range.startContainer.parentElement?.closest("[data-line-idx]");
    const endEl = range.endContainer.parentElement?.closest("[data-line-idx]");
    if (!startEl || !endEl) { setSelectionToolbar(null); return; }

    const startIdx = Number(startEl.getAttribute("data-line-idx"));
    const endIdx = Number(endEl.getAttribute("data-line-idx"));

    // Use last client rect for positioning near selection end
    const rects = range.getClientRects();
    const lastRect = rects[rects.length - 1] || range.getBoundingClientRect();

    // Position above selection, clamped to viewport
    const toolbarHeight = 36;
    const toolbarWidth = 120;
    let top = lastRect.top - toolbarHeight - 4;
    let left = lastRect.left + (lastRect.width / 2) - (toolbarWidth / 2);

    // Flip below if no room above
    if (top < 4) {
      top = lastRect.bottom + 4;
    }

    // Clamp horizontal
    left = Math.max(4, Math.min(left, window.innerWidth - toolbarWidth - 4));

    setSelectionToolbar({
      position: { top, left },
      lineNumber: startIdx + 1,
      selectedText,
      startOffset: range.startOffset,
      endLine: endIdx + 1,
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
