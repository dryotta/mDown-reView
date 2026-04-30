import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { isSidecarFile } from "@/lib/file-types";
import { useFileBadges } from "@/hooks/useFileBadges";
import { SkeletonLoader } from "./SkeletonLoader";
import { EnhancedViewer } from "./EnhancedViewer";
import { ImageViewerShell } from "./ImageViewerShell";
import { AudioViewer } from "./AudioViewer";
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

  const fileSize = useMemo(
    () => content ? new TextEncoder().encode(content).length : undefined,
    [content],
  );

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

    // RC4/P1.2 (#298) — read pendingScrollTarget via getState() (no
    // subscription) so the child `useScrollToLine` consume (which clears
    // the store) does not re-render ViewerRouter or re-fire this effect.
    // If a cross-file scroll target is queued for THIS file, the child
    // viewer's `useScrollToLine` mount-effect handles it; the saved-
    // scroll restore must skip so we don't overwrite the comment-anchored
    // scroll the child just applied. (The previous `suppressRestoreRef`
    // latch became dead code once the subscription was dropped — without
    // a re-render the effect's deps don't change, so a single getState()
    // check at mount is sufficient.)
    if (useStore.getState().pendingScrollTarget?.filePath === path) return;

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
  // unmount+remount, which stops audio playback that would otherwise
  // continue after a tab switch.
  //
  // Iter 5 Group B — media/binary viewers have no `EnhancedViewer` host, so we
  // mount a minimal `ViewerToolbar` (toggle hidden, no zoom) above each one
  // to surface the file-anchored "Comment on file" entry point universally.
  if (status === "image") {
    return <ImageViewerShell key={path} path={path} onCommentOnFile={commentOnFile} fileCommentCount={fileCommentCount} fileCommentSeverity={fileCommentSeverity} />;
  }

  if (status === "audio") {
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
        <AudioViewer key={path} path={path} />
      </div>
    );
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
        fileSize={fileSize}
        onCommentOnFile={commentOnFile}
        fileCommentCount={fileCommentCount}
        fileCommentSeverity={fileCommentSeverity}
      />
    </div>
  );
}
