import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { useSearch } from "@/hooks/useSearch";
import { useSourceHighlighting } from "@/hooks/useSourceHighlighting";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useFolding } from "@/hooks/useFolding";
import { useThreadsByLine } from "@/hooks/useThreadsByLine";
import { useScrollToLine } from "@/hooks/useScrollToLine";
import { useSourceLineModel, type SearchMatchInLine } from "@/hooks/useSourceLineModel";
import { SearchBar } from "./SearchBar";
import { SourceLine } from "./source/SourceLine";
import { SIZE_WARN_THRESHOLD, truncateSelectedText } from "@/lib/comment-utils";
import { isSidecarFile } from "@/lib/file-types";
import { emitCommentFlash, flashElement, onCommentFlash } from "@/lib/comment-flash";
import "@/styles/source-viewer.css";

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
  wordWrap?: boolean;
  zoom: number;
}

export function SourceView({ content, path, filePath, fileSize, wordWrap, zoom }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  // Sidecar files (.review.yaml/.review.json) are app-managed metadata,
  // not commentable content. Disable every "add comment" affordance and
  // suppress the selection toolbar / context menu while one is open.
  const commentable = !isSidecarFile(filePath);
  // Zoom is owned by `EnhancedViewer` (single owner of `useZoom` for the
  // active sub-view) and forwarded as a prop. The `--source-zoom` CSS
  // custom property below scales `.source-lines` text in CSS itself,
  // so toolbar buttons and Ctrl+= / Ctrl+- / Ctrl+0 all reach the
  // visible source text via one code path (#92).
  const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);
  const sourceLinesRef = useRef<HTMLDivElement>(null);

  const { threads } = useComments(filePath);

  const lines = useMemo(() => content.split("\n"), [content]);

  const { highlightedLines } = useSourceHighlighting(content, path);
  const { selectionToolbar, handleMouseUp, handleAddSelectionComment, dismissToolbar } =
    useSelectionToolbar();
  const { collapsedLines, foldStartMap, toggleFold } = useFolding(content, filePath);

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

  // Scroll-to-line from CommentsPanel click. Panel sends a `comment-flash`
  // event for the visual highlight; this hook owns the scroll only.
  const scrollToLineTransform = useCallback((line: number) => line - 1, []);
  useScrollToLine(sourceLinesRef, "data-line-idx", scrollToLineTransform, undefined, filePath);

  // Listen for cross-surface flash events. When the panel (or another
  // marker) emits a flash for a line in this file, find the matching
  // `[data-line-idx]` rows and run the keyframe animation imperatively
  // so re-clicking re-fires.
  useEffect(() => {
    return onCommentFlash((detail) => {
      if (detail.filePath !== filePath) return;
      const startLine = detail.line;
      const endLine = detail.endLine ?? detail.line;
      const root = sourceLinesRef.current;
      if (!root) return;
      for (let ln = startLine; ln <= endLine; ln++) {
        const el = root.querySelector(`[data-line-idx="${ln - 1}"]`) as HTMLElement | null;
        if (el) flashElement(el);
      }
    });
  }, [filePath]);

  // Stable handlers — recompute identity only when their dependencies actually
  // change. This is what allows `React.memo` on `SourceLine` to skip re-renders
  // for the other ~4999 lines while the user types in the search bar.
  const handleAddCommentClick = useCallback(
    (ln: number) => {
      const lineText = lines[ln - 1] ?? "";
      // MRSF §6.2: line-only comments SHOULD include full line as selected_text.
      const selected = truncateSelectedText(lineText);
      useStore.getState().requestLineCompose({
        filePath,
        anchor: { line: ln, selected_text: selected },
      });
    },
    [filePath, lines]
  );

  const handleMarkerClick = useCallback(
    (ln: number) => {
      emitCommentFlash({ filePath, line: ln });
    },
    [filePath]
  );

  const handleSelectionAdd = useCallback(() => {
    void handleAddSelectionComment(filePath);
  }, [handleAddSelectionComment, filePath]);

  const model = useSourceLineModel({
    lines,
    threadsByLine,
    foldStartMap,
    collapsedLines,
    query,
    matchesByLine,
    highlightedLines,
  });

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  return (
    <div
      className={`source-view${wordWrap ? " wrap-enabled" : ""}`}
      data-zoom={zoom}
      style={{ position: "relative", "--source-zoom": zoom } as React.CSSProperties}
    >
      {searchOpen && (
        <SearchBar
          query={query}
          matchCount={matches.length}
          currentIndex={currentIndex}
          onQueryChange={setQuery}
          onNext={next}
          onPrev={prev}
          onClose={() => {
            setSearchOpen(false);
            setQuery("");
          }}
        />
      )}
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      <div
        className="source-lines"
        ref={sourceLinesRef}
        onMouseUp={commentable ? handleMouseUp : undefined}
      >
        {model.map((item) => (
          <SourceLine
            key={item.idx}
            idx={item.idx}
            lineNum={item.lineNum}
            filePath={filePath}
            contentHtml={item.contentHtml}
            isSelectionActive={false}
            foldRegion={item.foldRegion}
            isCollapsed={item.isCollapsed}
            lineThreads={item.lineThreads}
            commentable={commentable}
            onToggleFold={toggleFold}
            onAddCommentClick={handleAddCommentClick}
            onMarkerClick={handleMarkerClick}
          />
        ))}
      </div>
      {commentable && selectionToolbar && (
        <SelectionToolbar
          position={selectionToolbar.position}
          onAddComment={handleSelectionAdd}
          onDismiss={dismissToolbar}
        />
      )}
    </div>
  );
}
