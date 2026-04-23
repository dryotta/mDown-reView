import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { SkeletonLoader } from "./SkeletonLoader";
import { EnhancedViewer } from "./EnhancedViewer";
import { ImageViewer } from "./ImageViewer";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { DeletedFileViewer } from "./DeletedFileViewer";

interface Props {
  path: string;
}

export function ViewerRouter({ path }: Props) {
  const { status, content, error } = useFileContent(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const setScrollTop = useStore((s) => s.setScrollTop);
  const tab = useStore((s) => s.tabs.find((t) => t.path === path));
  const ghostEntries = useStore((s) => s.ghostEntries);
  const isGhost = ghostEntries.some((g) => g.sourcePath === path);

  const savedScrollTop = tab?.scrollTop ?? 0;

  const fileSize = useMemo(
    () => content ? new TextEncoder().encode(content).length : undefined,
    [content],
  );

  // Restore scroll position after content renders.
  // Uses a rAF retry loop because async syntax highlighting (Shiki) and
  // images can change layout after the initial React render.
  useEffect(() => {
    if (!scrollRef.current || status !== "ready" || savedScrollTop <= 0) return;

    let cancelled = false;
    let retries = 10;

    const tryRestore = () => {
      if (cancelled || !scrollRef.current || retries <= 0) return;
      scrollRef.current.scrollTop = savedScrollTop;
      if (scrollRef.current.scrollTop > 0) return; // Scroll applied successfully
      retries--;
      requestAnimationFrame(tryRestore);
    };

    requestAnimationFrame(tryRestore);
    return () => { cancelled = true; };
  }, [path, status, content, savedScrollTop]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [path]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
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
      <div style={{ flex: 1, overflow: "auto" }}>
        <ImageViewer path={path} />
      </div>
    );
  }

  if (status === "binary" || status === "too_large") {
    return (
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        <BinaryPlaceholder path={path} />
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
