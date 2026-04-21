import { useEffect, useRef } from "react";
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
  const { setScrollTop, tabs } = useStore();
  const ghostEntries = useStore((s) => s.ghostEntries);
  const isGhost = ghostEntries.some((g) => g.sourcePath === path);
  const tab = tabs.find((t) => t.path === path);

  // Restore scroll position when tab becomes active
  useEffect(() => {
    if (scrollRef.current && tab) {
      scrollRef.current.scrollTop = tab.scrollTop;
    }
  }, [path]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(path, (e.target as HTMLDivElement).scrollTop);
  };

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

  const fileSize = content ? new Blob([content]).size : undefined;
  return (
    <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }} onScroll={handleScroll}>
      <EnhancedViewer content={content!} path={path} filePath={path} fileSize={fileSize} />
    </div>
  );
}
