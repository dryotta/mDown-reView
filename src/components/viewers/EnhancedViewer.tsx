import { Suspense, lazy, useState } from "react";
import { useStore } from "@/store";
import { getFileCategory, hasVisualization, getDefaultView, getFiletypeKey } from "@/lib/file-types";
import { useZoom } from "@/hooks/useZoom";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import { MarkdownViewer } from "./MarkdownViewer";
import { SourceView } from "./SourceView";
import { JsonTreeView } from "./JsonTreeView";
import { HtmlPreviewView } from "./HtmlPreviewView";
import { KqlPlanView } from "./KqlPlanView";
import { SkeletonLoader } from "./SkeletonLoader";

// Lazy-load heavy visualization components
const CsvTableView = lazy(() =>
  import("./CsvTableView").then((m) => ({ default: m.CsvTableView }))
);
const MermaidView = lazy(() =>
  import("./MermaidView").then((m) => ({ default: m.MermaidView }))
);

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
  /** Iter 5 Group B — forwarded to `ViewerToolbar` to surface a "Comment on file" button. */
  onCommentOnFile?: () => void;
}

export function EnhancedViewer({ content, path, filePath, fileSize, onCommentOnFile }: Props) {
  const category = getFileCategory(path);
  const canVisualize = hasVisualization(category);
  const defaultView = getDefaultView(category);
  const [wordWrap, setWordWrap] = useState(false);

  const viewMode = useStore((s) => s.viewModeByTab[filePath]) ?? defaultView;
  const setViewMode = useStore((s) => s.setViewMode);

  const handleViewChange = (mode: "source" | "visual") => {
    setViewMode(filePath, mode);
  };

  const showSource = viewMode === "source" || !canVisualize;
  // Zoom key tracks the active sub-view so source-mode zoom is independent of
  // visual-mode zoom for the same document (#65 D1/D2/D3).
  const filetypeKey = getFiletypeKey(path, showSource ? "source" : "visual");
  const { zoom, zoomIn, zoomOut, reset } = useZoom(filetypeKey);

  return (
    <div className="enhanced-viewer">
      {/* L1 — file actions live in the toolbar's `trailing` slot so they
          inherit its sticky positioning instead of becoming a sibling row. */}
      <ViewerToolbar
        activeView={viewMode}
        onViewChange={handleViewChange}
        hidden={!canVisualize}
        showWrapToggle={showSource}
        wordWrap={wordWrap}
        onToggleWrap={() => setWordWrap(!wordWrap)}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        onCommentOnFile={onCommentOnFile}
        trailing={<FileActionsBar path={filePath} />}
      />
      {showSource ? (
        <SourceView content={content} path={path} filePath={filePath} fileSize={fileSize} wordWrap={wordWrap} />
      ) : (
        <Suspense fallback={<SkeletonLoader />}>
          {renderVisualView(category, content, path, filePath, fileSize)}
        </Suspense>
      )}
    </div>
  );
}

function renderVisualView(
  category: string,
  content: string,
  path: string,
  filePath: string,
  fileSize?: number
) {
  switch (category) {
    case "markdown":
      return <MarkdownViewer content={content} filePath={filePath} fileSize={fileSize} />;
    case "json":
      return <JsonTreeView content={content} path={path} />;
    case "csv":
      return <CsvTableView content={content} path={path} />;
    case "html":
      return <HtmlPreviewView content={content} filePath={filePath} />;
    case "mermaid":
      return <MermaidView content={content} path={path} />;
    case "kql":
      return <KqlPlanView content={content} />;
    default:
      return null;
  }
}
