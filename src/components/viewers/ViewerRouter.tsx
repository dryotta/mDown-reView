import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { SkeletonLoader } from "./SkeletonLoader";
import { EnhancedViewer } from "./EnhancedViewer";
import { ImageViewer } from "./ImageViewer";
import { AudioViewer } from "./AudioViewer";
import { VideoViewer } from "./VideoViewer";
import { PdfViewer } from "./PdfViewer";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { TooLargePlaceholder } from "./TooLargePlaceholder";
import { DeletedFileViewer } from "./DeletedFileViewer";
import { ViewerToolbar } from "./ViewerToolbar";

interface Props {
  path: string;
}

/**
 * G4 — wrap viewers that don't already render a `ViewerToolbar` (image,
 * audio, video, pdf) in a column flex with a slim action toolbar at the top
 * exposing reveal/open. EnhancedViewer renders its own toolbar internally,
 * BinaryPlaceholder/TooLarge/Deleted have their own action surfaces, so they
 * are not wrapped here.
 */
function withActionToolbar(path: string, child: ReactNode): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewerToolbar activeView="visual" onViewChange={() => {}} hidden path={path} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{child}</div>
    </div>
  );
}

export function ViewerRouter({ path }: Props) {
  const { status, content, error, sizeBytes } = useFileContent(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const setScrollTop = useStore((s) => s.setScrollTop);
  const ghostEntries = useStore((s) => s.ghostEntries);
  const isGhost = ghostEntries.some((g) => g.sourcePath === path);

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
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        <SkeletonLoader />
      </div>
    );
  }

  if (status === "image") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {withActionToolbar(path, <ImageViewer path={path} />)}
      </div>
    );
  }

  if (status === "audio") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {withActionToolbar(path, <AudioViewer path={path} />)}
      </div>
    );
  }

  if (status === "video") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {withActionToolbar(path, <VideoViewer path={path} />)}
      </div>
    );
  }

  if (status === "pdf") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {withActionToolbar(path, <PdfViewer path={path} />)}
      </div>
    );
  }

  if (status === "too_large") {
    return (
      <div style={{ flex: 1, overflow: "auto" }}>
        <TooLargePlaceholder path={path} size={sizeBytes} />
      </div>
    );
  }

  if (status === "binary") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <BinaryPlaceholder path={path} size={sizeBytes} />
      </div>
    );
  }

  if (status === "error") {
    if (isGhost) {
      return <DeletedFileViewer filePath={path} />;
    }
    return (
      <div style={{ padding: 20, color: "var(--color-badge)" }}>
        Error loading file: {error}
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }} onScroll={handleScroll}>
      <EnhancedViewer content={content!} path={path} filePath={path} fileSize={fileSize} />
    </div>
  );
}
