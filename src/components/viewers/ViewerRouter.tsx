import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { isSidecarFile } from "@/lib/file-types";
import { useFileBadges } from "@/hooks/useFileBadges";
import { SkeletonLoader } from "./SkeletonLoader";
import { EnhancedViewer } from "./EnhancedViewer";
import { ImageViewerShell } from "./ImageViewerShell";
import { BinaryViewerShell } from "./BinaryViewerShell";
import { TooLargePlaceholder } from "./TooLargePlaceholder";
import { DeletedFileViewer } from "./DeletedFileViewer";
import { FileActionsBar } from "./FileActionsBar";
import { ViewerToolbar } from "./ViewerToolbar";
import { useRenderCount } from "@/hooks/dev/useRenderCount";

interface Props {
  path: string;
}

export function ViewerRouter({ path }: Props) {
  useRenderCount("ViewerRouter");
  const { status, content, error, sizeBytes, mtimeMs } = useFileContent(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const setScrollTop = useStore((s) => s.setScrollTop);
  const ghostEntries = useStore((s) => s.ghostEntries);
  const isGhost = ghostEntries.some((g) => g.sourcePath === path);

  // RC4/P1.2 (#298) — layout-effect latch handles the child→parent
  // passive-effect ordering: when content arrives and ViewerRouter
  // re-renders with status="ready", the child viewer's useScrollToLine
  // mount-effect (which runs FIRST, child→parent) consumes the pending
  // target and applies the comment-anchored scroll. Without this latch,
  // the parent's restore effect would later read getState() and see
  // pendingScrollTarget cleared, missing the guard and overwriting the
  // scroll. Layout effects fire BEFORE passive effects, so the latch is
  // set synchronously after each commit and survives the child's consume.
  //
  // We dropped the useStore selector subscription (not the latch): the
  // subscription was a separate concern (writer→clear churn re-rendered
  // ViewerRouter twice per nav). With no subscription, the parent does
  // not re-render when the slot clears; with the latch, the parent's
  // passive effect still sees the slot was set during the mount cycle.
  const suppressRestoreRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const t = useStore.getState().pendingScrollTarget;
    if (t?.filePath === path) {
      suppressRestoreRef.current = path;
    }
    return () => {
      suppressRestoreRef.current = null;
    };
  }, [path]);

  // Iter 5 Group B— every viewer surfaces a file-anchored authoring entry
  // point. Reading through `useStore.getState()` at click time (not via a
  // selector) keeps this off the render path; the action itself is a stable
  // store reference so callers don't need to re-render when it changes.
  // Sidecar files (.review.yaml/.review.json) are app-managed metadata —
  // omit the callback so every viewer's "Comment on file" button is
  // suppressed at the toolbar level (ViewerToolbar already gates rendering
  // on the callback being defined).
  const isSidecar = isSidecarFile(path);
  const handleCommentOnFile = useCallback(() => {
    useStore.getState().requestFileLevelInput(path);
  }, [path]);
  const commentOnFile = isSidecar ? undefined : handleCommentOnFile;

  // File-level badge data: count of unresolved file-anchored threads + worst
  // severity. Reuses `get_file_badges` (same IPC the tree/tabs use, so the
  // sidecar load is amortised across surfaces; reloads on `comments-changed`
  // are debounced inside the hook). Memoise the path array so the hook's
  // pathsKey effect doesn't refire on every render.
  const fileBadgePaths = useMemo(() => [path], [path]);
  const fileBadges = useFileBadges(fileBadgePaths);
  const fileCommentCount = fileBadges[path]?.file_level_count ?? 0;
  const fileCommentSeverity = fileBadges[path]?.max_severity ?? null;

  // Guard flag: suppresses scroll-save during programmatic scroll restore
  const restoringRef = useRef(false);

  // Restore scroll position after content renders.
  // Uses a rAF retry loop because async syntax highlighting (Shiki) and
  // images can change layout after the initial React render.
  //
  // IMPORTANT: reads the restore target from the store at effect time via
  // useStore.getState() instead of depending on a derived `savedScrollTop`.
  // This breaks the save→re-render→restore→save feedback loop that caused
  // infinite scroll oscillation.
  useEffect(() => {
    if (!scrollRef.current || status !== "ready") return;

    // RC4/P1.2 (#298) — skip saved-scroll restore when a cross-file
    // scroll target was/is queued for THIS file. The layout-effect latch
    // above captures the slot state synchronously during the mount cycle
    // so the child `useScrollToLine` passive-effect consume cannot blank
    // our view of it. (Reading via `useStore.getState()` here would race
    // the child's consume because passive effects fire child→parent.)
    if (suppressRestoreRef.current === path) return;

    const target = useStore.getState().tabs.find((t) => t.path === path)?.scrollTop ?? 0;

    // Explicitly restore to 0 on tab switch when target is 0
    if (target <= 0) {
      scrollRef.current.scrollTop = 0;
      return;
    }

    let cancelled = false;
    let retries = 20; // More retries for async Shiki highlighting

    const tryRestore = () => {
      if (cancelled || !scrollRef.current || retries <= 0) {
        restoringRef.current = false;
        return;
      }
      restoringRef.current = true;
      scrollRef.current.scrollTop = target;
      // Check if scroll was applied (content tall enough)
      if (scrollRef.current.scrollTop > 0) {
        restoringRef.current = false;
        return;
      }
      retries--;
      requestAnimationFrame(tryRestore);
    };

    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
      restoringRef.current = false;
    };
  }, [path, status, content]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [path]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Skip saves during programmatic scroll restore to prevent feedback loop
    if (restoringRef.current) return;

    const top = (e.target as HTMLDivElement).scrollTop;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(path, top);
    });
  }, [path, setScrollTop]);

  if (status === "loading") {
    return (
      <div ref={scrollRef} className="viewer-scroll-region">
        <SkeletonLoader />
      </div>
    );
  }

  // R1+R2+R3 — every routed viewer is keyed on `path`. A path change forces
  // unmount+remount so per-file viewer state (hex bytes, error message,
  // scroll position) does not leak across tab switches.
  //
  // Iter 5 Group B — media/binary viewers have no `EnhancedViewer` host, so we
  // mount a minimal `ViewerToolbar` (toggle hidden, no zoom) above each one
  // to surface the file-anchored "Comment on file" entry point universally.
  if (status === "image") {
    return <ImageViewerShell key={path} path={path} onCommentOnFile={commentOnFile} fileCommentCount={fileCommentCount} fileCommentSeverity={fileCommentSeverity} />;
  }

  if (status === "too_large") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={commentOnFile}
          fileCommentCount={fileCommentCount}
          fileCommentSeverity={fileCommentSeverity}
          trailing={<FileActionsBar path={path} />}
        />
        <TooLargePlaceholder key={path} path={path} size={sizeBytes} />
      </div>
    );
  }

  if (status === "binary") {
    return <BinaryViewerShell key={path} path={path} size={sizeBytes} mtime={mtimeMs} onCommentOnFile={commentOnFile} fileCommentCount={fileCommentCount} fileCommentSeverity={fileCommentSeverity} />;
  }

  if (status === "error") {
    if (isGhost) {
      return (
        <div className="viewer-media-container">
          <ViewerToolbar
            activeView="visual"
            onViewChange={() => {}}
            hidden
            onCommentOnFile={commentOnFile}
            fileCommentCount={fileCommentCount}
            fileCommentSeverity={fileCommentSeverity}
          />
          <DeletedFileViewer key={path} filePath={path} />
        </div>
      );
    }
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={commentOnFile}
          fileCommentCount={fileCommentCount}
          fileCommentSeverity={fileCommentSeverity}
          trailing={<FileActionsBar path={path} />}
        />
        <div className="viewer-placeholder">
          Error loading file: {error}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="viewer-scroll-region" onScroll={handleScroll}>
      <EnhancedViewer
        key={path}
        content={content!}
        path={path}
        filePath={path}
        fileSize={sizeBytes}
        onCommentOnFile={commentOnFile}
        fileCommentCount={fileCommentCount}
        fileCommentSeverity={fileCommentSeverity}
      />
    </div>
  );
}
