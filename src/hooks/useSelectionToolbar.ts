import { useState, useCallback } from "react";
import { computeAnchorHash } from "@/lib/tauri-commands";
import { truncateSelectedText } from "@/lib/comment-utils";
import { fingerprintAnchor } from "@/lib/anchor-fingerprint";
import { useStore } from "@/store";

interface SelectionState {
  position: { top: number; left: number };
  lineNumber: number;
  selectedText: string;
  startOffset: number;
  endLine: number;
  endOffset: number;
}

/**
 * Selection toolbar for both source and markdown viewers.
 *
 * On mouseup over a non-collapsed selection inside a `[lineAttribute]`
 * region, sets `selectionToolbar` so the floating chip can render. When
 * the user clicks "Comment" on the chip, [`handleAddSelectionComment`]
 * computes a Line anchor for the selection (line, end_line, start/end
 * column, selected_text, selected_text_hash) and seeds a panel composer
 * via `requestLineCompose` — authoring is panel-only, so the selection
 * never mounts an inline composer.
 */
export function useSelectionToolbar(lineAttribute = "data-line-idx", lineOffset = 1) {
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionState | null>(null);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelectionToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rawText = sel.toString();
    // Strip leading/trailing whitespace before storing — selections that
    // extend slightly past a word (a common triple-click overshoot) or
    // that include a trailing newline from a paragraph boundary would
    // otherwise persist with that noise into the MRSF sidecar and break
    // the matcher's per-line substring search (file lines are split on
    // '\n', so a stored "\n" can never substring-match a single line).
    const selectedText = rawText.trim();
    if (!selectedText) {
      setSelectionToolbar(null);
      return;
    }

    const startEl = range.startContainer.parentElement?.closest(`[${lineAttribute}]`);
    const endEl = range.endContainer.parentElement?.closest(`[${lineAttribute}]`);
    if (!startEl || !endEl) {
      setSelectionToolbar(null);
      return;
    }

    const startIdx = Number(startEl.getAttribute(lineAttribute));
    const endIdx = Number(endEl.getAttribute(lineAttribute));

    // Use last client rect for positioning near selection end. When
    // `getClientRects()` returns nothing (Range collapsed-at-boundary,
    // selection spanning hidden nodes, or some odd shadow-DOM cases),
    // fall back to a temporary zero-width range placed at the selection's
    // end point so we can still read a usable caret rect.
    const rects = range.getClientRects();
    let lastRect: DOMRect | null = rects.length > 0 ? (rects[rects.length - 1] as DOMRect) : null;
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
    let left = lastRect.left + lastRect.width / 2 - toolbarWidth / 2;

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

  const handleAddSelectionComment = useCallback(
    async (filePath: string) => {
      if (!selectionToolbar) return;
      const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;
      const truncated = truncateSelectedText(selectedText);
      const hash = await computeAnchorHash(truncated);
      const anchor = {
        line: lineNumber,
        end_line: endLine,
        start_column: startOffset,
        end_column: endOffset,
        selected_text: truncated,
        selected_text_hash: hash,
      };
      useStore.getState().requestLineCompose({
        filePath,
        anchor,
        // Selection composers use a fingerprint draft key so concurrent
        // line-only and selection composers for the same line don't collide.
        draftKey: `${filePath}::new::${fingerprintAnchor({ kind: "line", ...anchor })}`,
      });
      setSelectionToolbar(null);
    },
    [selectionToolbar]
  );

  const dismissToolbar = useCallback(() => {
    setSelectionToolbar(null);
  }, []);

  return {
    selectionToolbar,
    setSelectionToolbar,
    handleMouseUp,
    handleAddSelectionComment,
    dismissToolbar,
  };
}
