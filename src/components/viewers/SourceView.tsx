import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { CommentContextMenu } from "@/components/comments/CommentContextMenu";
import { useSearch } from "@/hooks/useSearch";
import { useSourceHighlighting } from "@/hooks/useSourceHighlighting";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useFolding } from "@/hooks/useFolding";
import { useThreadsByLine } from "@/hooks/useThreadsByLine";
import { useScrollToLine } from "@/hooks/useScrollToLine";
import { useSourceLineModel, type SearchMatchInLine } from "@/hooks/useSourceLineModel";
import { useViewerContextMenu } from "@/hooks/useViewerContextMenu";
import { SearchBar } from "./SearchBar";
import { SourceLine } from "./source/SourceLine";
import { SIZE_WARN_THRESHOLD } from "@/lib/comment-utils";
import { useZoom } from "@/hooks/useZoom";
import "@/styles/source-viewer.css";

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
  wordWrap?: boolean;
}

export function SourceView({ content, path, filePath, fileSize, wordWrap }: Props) {
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Source view uses its own filetype key so source-mode zoom is independent
  // of visual-mode zoom for the same document (#65 D1/D2/D3).
  const { zoom } = useZoom(".source");
  const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);
  const sourceLinesRef = useRef<HTMLDivElement>(null);

  const { threads } = useComments(filePath);
  const { addComment, commitMoveAnchor } = useCommentActions();

  const lines = useMemo(() => content.split("\n"), [content]);

  const { highlightedLines } = useSourceHighlighting(content, path);
  const {
    selectionToolbar,
    setSelectionToolbar,
    pendingSelectionAnchor,
    highlightedSelectionLines,
    handleMouseUp,
    handleAddSelectionComment,
    clearSelection,
  } = useSelectionToolbar();
  const { collapsedLines, foldStartMap, toggleFold } = useFolding(content, filePath);

  // Reset selection when file changes
  useEffect(() => { clearSelection(); }, [filePath, clearSelection]);

  // Ctrl+F keyboard handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Search match lookup by line
  const matchesByLine = useMemo(() => {
    const map = new Map<number, SearchMatchInLine[]>();
    matches.forEach((m, i) => {
      const arr = map.get(m.lineIndex) ?? [];
      arr.push({ startCol: m.startCol, endCol: m.endCol, isCurrent: i === currentIndex });
      map.set(m.lineIndex, arr);
    });
    return map;
  }, [matches, currentIndex]);

  const { threadsByLine } = useThreadsByLine(threads);

  // Auto-scroll to current match
  useEffect(() => {
    if (currentIndex < 0 || !matches[currentIndex]) return;
    const lineIdx = matches[currentIndex].lineIndex;
    const lineEl = document.querySelector(`[data-line-idx="${lineIdx}"]`);
    lineEl?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex, matches]);

  // Scroll-to-line from CommentsPanel click
  const scrollToLineTransform = useCallback((line: number) => line - 1, []);
  const handleScrollTo = useCallback((line: number) => {
    setExpandedLine(line);
    setCommentingLine(null);
  }, []);
  useScrollToLine(sourceLinesRef, "data-line-idx", scrollToLineTransform, handleScrollTo, filePath);

  // Stable handlers — recompute identity only when their dependencies actually
  // change. This is what allows `React.memo` on `SourceLine` to skip re-renders
  // for the other ~4999 lines while the user types in the search bar.
  const handleCommentButtonClick = useCallback((ln: number) => {
    const lt = threadsByLine.get(ln) ?? [];
    if (lt.length > 0 && expandedLine !== ln) {
      setExpandedLine(ln);
      setCommentingLine(null);
      clearSelection();
    } else {
      clearSelection();
      setCommentingLine((prev) => (prev === ln ? null : ln));
    }
  }, [expandedLine, threadsByLine, clearSelection]);

  const handleCloseInput = useCallback(() => {
    setCommentingLine(null);
    setExpandedLine(null);
    clearSelection();
  }, [clearSelection]);

  const handleRequestInput = useCallback((ln: number) => {
    setCommentingLine(ln);
  }, []);

  const model = useSourceLineModel({
    lines,
    threadsByLine,
    foldStartMap,
    collapsedLines,
    query,
    matchesByLine,
    highlightedLines,
    expandedLine,
    commentingLine,
  });

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const handleSourceLinesClick = useCallback((e: React.MouseEvent) => {
    const moveTarget = useStore.getState().moveAnchorTarget;
    if (moveTarget === null) return;
    const lineEl = (e.target as HTMLElement).closest<HTMLElement>("[data-line-idx]");
    const idxStr = lineEl?.dataset.lineIdx;
    if (idxStr !== undefined) {
      const lineIdx = parseInt(idxStr, 10);
      if (!Number.isNaN(lineIdx)) {
        // Source view is 0-indexed in DOM; commenter API is 1-indexed.
        const line = lineIdx + 1;
        void commitMoveAnchor(filePath, moveTarget, { kind: "line", line });
        useStore.getState().setMoveAnchorTarget(null);
        e.stopPropagation();
      }
    }
    // Missed click (no [data-line-idx] under target, or NaN) → leave move
    // mode active. Esc / Cancel button still cancels.
  }, [commitMoveAnchor, filePath]);

  // F6 — right-click context menu. Source view lines use `data-line-idx`
  // (0-indexed in DOM); commenter API is 1-indexed, so we add 1.
  const { ctxMenu, handleContextMenu, handleContextAction, closeContextMenu } = useViewerContextMenu({
    filePath,
    resolveLine: (target) => {
      const lineEl = target.closest<HTMLElement>("[data-line-idx]");
      if (!lineEl?.dataset.lineIdx) return null;
      const idx = Number(lineEl.dataset.lineIdx);
      return Number.isFinite(idx) ? idx + 1 : null;
    },
    primeSelection: handleMouseUp,
    startSelectionComment: () => void handleAddSelectionComment(setCommentingLine),
  });

  return (
    <div className={`source-view${wordWrap ? " wrap-enabled" : ""}`} data-zoom={zoom} style={{ position: "relative", fontSize: `${zoom * 100}%` }}>
      {searchOpen && (
        <SearchBar
          query={query}
          matchCount={matches.length}
          currentIndex={currentIndex}
          onQueryChange={setQuery}
          onNext={next}
          onPrev={prev}
          onClose={() => { setSearchOpen(false); setQuery(""); }}
        />
      )}
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      <div className="source-lines" ref={sourceLinesRef} onClick={handleSourceLinesClick} onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
        {model.map((item) => {
          // Build the per-line save callback only for the currently-commenting
          // line; all other lines receive `undefined` (a stable reference) so
          // React.memo continues to skip them on unrelated re-renders.
          const onSaveComment =
            pendingSelectionAnchor && item.isCommenting
              ? (text: string) => {
                  addComment(filePath, text, pendingSelectionAnchor).catch(() => {});
                  clearSelection();
                }
              : undefined;
          return (
            <SourceLine
              key={item.idx}
              idx={item.idx}
              lineNum={item.lineNum}
              line={item.line}
              filePath={filePath}
              contentHtml={item.contentHtml}
              isSelectionActive={highlightedSelectionLines.has(item.lineNum)}
              foldRegion={item.foldRegion}
              isCollapsed={item.isCollapsed}
              lineThreads={item.lineThreads}
              isCommenting={item.isCommenting}
              isExpanded={item.isExpanded}
              onToggleFold={toggleFold}
              onCommentButtonClick={handleCommentButtonClick}
              onCloseInput={handleCloseInput}
              onRequestInput={handleRequestInput}
              onSaveComment={onSaveComment}
            />
          );
        })}
      </div>
      {selectionToolbar && (
        <SelectionToolbar
          position={selectionToolbar.position}
          onAddComment={() => handleAddSelectionComment(setCommentingLine)}
          onDismiss={() => setSelectionToolbar(null)}
        />
      )}
      <CommentContextMenu
        open={ctxMenu.state.open}
        x={ctxMenu.state.x}
        y={ctxMenu.state.y}
        hasSelection={ctxMenu.state.payload?.hasSelection ?? false}
        hasLine={ctxMenu.state.payload?.line != null}
        onAction={handleContextAction}
        onClose={closeContextMenu}
      />
    </div>
  );
}
