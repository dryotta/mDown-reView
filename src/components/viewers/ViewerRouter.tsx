import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { SkeletonLoader } from "./SkeletonLoader";
import { EnhancedViewer } from "./EnhancedViewer";
import { ImageViewer } from "./ImageViewer";
import { AudioViewer, getAudioMime } from "./AudioViewer";
import { VideoViewer, getVideoMime } from "./VideoViewer";
import { PdfViewer } from "./PdfViewer";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { TooLargePlaceholder } from "./TooLargePlaceholder";
import { DeletedFileViewer } from "./DeletedFileViewer";
import { FileActionsBar } from "./FileActionsBar";
import { ViewerToolbar } from "./ViewerToolbar";

interface Props {
  path: string;
}

export function ViewerRouter({ path }: Props) {
  const { status, content, error, sizeBytes } = useFileContent(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const setScrollTop = useStore((s) => s.setScrollTop);
  const ghostEntries = useStore((s) => s.ghostEntries);
  const isGhost = ghostEntries.some((g) => g.sourcePath === path);
  // B1 forward-fix: when a cross-file scroll target is queued for THIS
  // viewer, suppress saved-scroll restore so the child's `useScrollToLine`
  // mount-effect (which runs first) is not overwritten by the parent's
  // restore (which runs second). React passive effects run child→parent.
  const pendingScrollTarget = useStore((s) => s.pendingScrollTarget);

  // Iter 11 re-fix: latch the suppression independently of the live store
  // value. The child `useScrollToLine` consumes the pending target on mount
  // (sets it to null), which re-renders ViewerRouter with
  // `pendingScrollTarget === null`. If we keyed the early-return on the
  // live store value, the restore effect would then re-fire UNGUARDED and
  // overwrite the just-applied comment scroll. The ref records "I observed
  // a matching pending target during this mount cycle" and stays set even
  // after the child clears the store. Captured in a layout effect (runs
  // before passive effects) so the latch is set before the child's mount
  // useEffect consumes the store value. Reset on path change via cleanup.
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

  // Iter 5 Group B — every viewer surfaces a file-anchored authoring entry
  // point. Reading through `useStore.getState()` at click time (not via a
  // selector) keeps this off the render path; the action itself is a stable
  // store reference so callers don't need to re-render when it changes.
  const handleCommentOnFile = useCallback(() => {
    useStore.getState().requestFileLevelInput(path);
  }, [path]);

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

    // B1 forward-fix: skip the saved-scroll restore when a cross-file
    // scroll target is/was queued for THIS file. The latch is set during
    // render (see `suppressRestoreRef` above) and stays set even after
    // `useScrollToLine` consumes the store value, which would otherwise
    // re-fire this effect (deps include `pendingScrollTarget`) with
    // `pendingScrollTarget === null` and undo the comment-anchored scroll.
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
  }, [path, status, content, pendingScrollTarget]);

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
  // unmount+remount, which: (a) drops PdfViewer's stale `loadError`, (b) stops
  // audio/video playback that would otherwise continue after a tab switch,
  // (c) resets HexView byte state without an explicit `setBytes(null)` effect.
  //
  // Iter 5 Group B — media/binary viewers have no `EnhancedViewer` host, so we
  // mount a minimal `ViewerToolbar` (toggle hidden, no zoom) above each one
  // to surface the file-anchored "Comment on file" entry point universally.
  if (status === "image") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
          trailing={<FileActionsBar path={path} />}
        />
        <ImageViewer key={path} path={path} />
      </div>
    );
  }

  if (status === "audio") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
          trailing={<FileActionsBar path={path} mime={getAudioMime(path)} />}
        />
        <AudioViewer key={path} path={path} />
      </div>
    );
  }

  if (status === "video") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
          trailing={<FileActionsBar path={path} mime={getVideoMime(path)} />}
        />
        <VideoViewer key={path} path={path} />
      </div>
    );
  }

  if (status === "pdf") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
          trailing={<FileActionsBar path={path} />}
        />
        <PdfViewer key={path} path={path} />
      </div>
    );
  }

  if (status === "too_large") {
    return (
      <div className="viewer-scroll-region">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
        />
        <TooLargePlaceholder key={path} path={path} size={sizeBytes} />
      </div>
    );
  }

  if (status === "binary") {
    return (
      <div className="viewer-media-container">
        <ViewerToolbar
          activeView="visual"
          onViewChange={() => {}}
          hidden
          onCommentOnFile={handleCommentOnFile}
        />
        <BinaryPlaceholder key={path} path={path} size={sizeBytes} />
      </div>
    );
  }

  if (status === "error") {
    if (isGhost) {
      return <DeletedFileViewer key={path} filePath={path} />;
    }
    return (
      <div className="viewer-error">
        Error loading file: {error}
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
        onCommentOnFile={handleCommentOnFile}
      />
    </div>
  );
}
