import { useEffect, useState, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { truncateSelectedText } from "@/lib/comment-utils";
import {
  SIZE_WARN_THRESHOLD,
  SOURCE_BASE_LINE_PX,
  SOURCE_OVERSCAN,
} from "@/lib/viewer-budgets";
import { isSidecarFile } from "@/lib/file-types";
import { emitCommentFlash } from "@/lib/comment-flash";
import { useCommentFlashListener } from "@/hooks/useCommentFlashListener";
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

  const model = useSourceLineModel({
    lines,
    threadsByLine,
    foldStartMap,
    collapsedLines,
    query,
    matchesByLine,
    highlightedLines,
  });

  // Iter 2 of #252 — row virtualisation. The model is the post-fold
  // sequence of LineModel items; the virtualizer windows them into the
  // viewport. `getScrollElement` returns the `.source-lines` container
  // (overflow-auto, the sole scrolling chokepoint of this viewer).
  // The default `measureElement` reads `element.offsetHeight` which lets
  // word-wrapped rows recompute height after layout so the spacer height
  // stays accurate.
  const rowVirtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => sourceLinesRef.current,
    estimateSize: () => SOURCE_BASE_LINE_PX,
    overscan: SOURCE_OVERSCAN,
  });

  // Map a 0-indexed line number back to its post-fold row index in the
  // virtualizer. Returns -1 when the line is inside a collapsed fold.
  const lineToRowIdx = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < model.length; i++) {
      m.set(model[i].idx, i);
    }
    return m;
  }, [model]);

  const scrollLineIntoView = useCallback(
    (lineIdx0: number, align: "center" | "start" | "auto" = "center") => {
      const rowIdx = lineToRowIdx.get(lineIdx0);
      if (rowIdx === undefined) return false;
      rowVirtualizer.scrollToIndex(rowIdx, { align });
      return true;
    },
    [lineToRowIdx, rowVirtualizer],
  );

  // Auto-scroll to current match — virtualiser drives the scroll so rows
  // outside the rendered window mount in time for the match to be visible.
  useEffect(() => {
    if (currentIndex < 0 || !matches[currentIndex]) return;
    scrollLineIntoView(matches[currentIndex].lineIndex);
  }, [currentIndex, matches, scrollLineIntoView]);

  // Scroll-to-line from CommentsPanel click. Panel sends a `comment-flash`
  // event for the visual highlight; this hook owns the scroll only.
  const scrollToLineTransform = useCallback((line: number) => line - 1, []);
  // Iter 2 of #252 — `scrollOverride` lets the virtualiser handle scroll
  // for off-screen rows. Returns true when the row is in the model
  // (i.e. not inside a collapsed fold).
  const scrollOverride = useCallback(
    (line: number) => scrollLineIntoView(line - 1),
    [scrollLineIntoView],
  );
  useScrollToLine(
    sourceLinesRef,
    "data-line-idx",
    scrollToLineTransform,
    undefined,
    filePath,
    scrollOverride,
  );

  // Cross-surface flash listener — shared with MarkdownViewer via
  // `useCommentFlashListener`. SourceView's row attribute is `data-line-idx`
  // (0-indexed), so we pass a custom selector that converts the 1-indexed
  // detail.line to the 0-indexed DOM attribute. The `onMissingElement`
  // hook drives the virtualiser so flashes for off-screen lines scroll-
  // then-flash via the listener's RAF retry.
  useCommentFlashListener(filePath, sourceLinesRef, {
    selector: (line) => `[data-line-idx="${line - 1}"]`,
    onMissingElement: (line) => scrollLineIntoView(line - 1),
  });

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
      // Marker click on a single source-view row — kind is always "line".
      // (Range/file/unmatched flashes originate from CommentsPanel, which
      // has access to the full MatchedComment context for kind derivation.)
      emitCommentFlash({ kind: "line", filePath, line: ln });
    },
    [filePath]
  );

  const handleSelectionAdd = useCallback(() => {
    void handleAddSelectionComment(filePath);
  }, [handleAddSelectionComment, filePath]);

  // Iter 2 of #252 — `.source-lines` is the inner scroll container (overflow:
  // auto + flex-bounded — see `source-viewer.css`). Because scrolling no
  // longer happens on `ViewerRouter`'s `.viewer-scroll-region`, the existing
  // tab-level `scrollTop` save/restore in `ViewerRouter` is a no-op for
  // source-mode tabs. Restore the contract here: read the saved scroll on
  // mount/file-change, and save on scroll. State stays in `tabs[].scrollTop`
  // so cross-mode (visual ↔ source) and cross-tab navigation continue to
  // behave the same as before.
  useLayoutEffect(() => {
    const el = sourceLinesRef.current;
    if (!el) return;
    const saved =
      useStore.getState().tabs.find((t) => t.path === filePath)?.scrollTop ?? 0;
    if (saved <= 0) {
      el.scrollTop = 0;
      return;
    }
    // The virtualiser may not have measured rows yet; retry up to ~20 frames
    // (mirrors the `ViewerRouter` retry loop) until the scroll position
    // applies (i.e. the spacer has grown tall enough to accept it).
    let cancelled = false;
    let retries = 20;
    const tryRestore = () => {
      if (cancelled || !sourceLinesRef.current || retries <= 0) return;
      sourceLinesRef.current.scrollTop = saved;
      if (sourceLinesRef.current.scrollTop > 0) return;
      retries--;
      requestAnimationFrame(tryRestore);
    };
    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const setScrollTopAction = useStore((s) => s.setScrollTop);
  const scrollSaveRafRef = useRef<number | null>(null);
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const top = (e.target as HTMLDivElement).scrollTop;
      if (scrollSaveRafRef.current !== null) {
        cancelAnimationFrame(scrollSaveRafRef.current);
      }
      scrollSaveRafRef.current = requestAnimationFrame(() => {
        scrollSaveRafRef.current = null;
        setScrollTopAction(filePath, top);
      });
    },
    [filePath, setScrollTopAction],
  );
  useEffect(() => {
    return () => {
      if (scrollSaveRafRef.current !== null) {
        cancelAnimationFrame(scrollSaveRafRef.current);
      }
    };
  }, []);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

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
        onScroll={handleScroll}
      >
        <div
          className="source-lines-spacer"
          style={{ height: `${totalSize}px`, position: "relative", width: "100%" }}
        >
          {virtualItems.map((vi) => {
            const item = model[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <SourceLine
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
              </div>
            );
          })}
        </div>
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
