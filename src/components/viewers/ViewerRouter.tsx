import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { useFileContent } from "@/hooks/useFileContent";
import { extname } from "@/lib/path-utils";
import { SkeletonLoader } from "./SkeletonLoader";
import { MarkdownViewer } from "./MarkdownViewer";
import { SourceViewer } from "./SourceViewer";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import "@/styles/source-viewer.css";

const MD_EXTENSIONS = new Set([".md", ".mdx"]);

interface Props {
  path: string;
}

export function ViewerRouter({ path }: Props) {
  const { status, content, error } = useFileContent(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setScrollTop, tabs } = useStore();
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

  if (status === "binary" || status === "too_large") {
    return (
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        <BinaryPlaceholder path={path} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ padding: 20, color: "var(--color-badge)" }}>
        Error loading file: {error}
      </div>
    );
  }

  const ext = extname(path);
  const fileSize = content ? new Blob([content]).size : undefined;
  if (MD_EXTENSIONS.has(ext)) {
    return (
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }} onScroll={handleScroll}>
        <MarkdownViewer content={content!} filePath={path} fileSize={fileSize} />
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }} onScroll={handleScroll}>
      <SourceViewer content={content!} path={path} fileSize={fileSize} />
    </div>
  );
}
