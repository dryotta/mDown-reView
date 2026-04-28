import { Suspense, lazy, useState, useRef } from "react";
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
import type { MermaidViewHandle } from "./MermaidView";

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
  const mermaidRef = useRef<MermaidViewHandle>(null);

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

  const isMermaidVisual = category === "mermaid" && !showSource;

  // Categories whose visual view must fill the viewport (not scroll with
  // content). These get `enhanced-viewer--fill` which adds `height: 100%`
  // so children can resolve percentage heights.
  const needsFill = !showSource && (category === "mermaid" || category === "csv" || category === "kql" || category === "html");

  return (
    <div className={`enhanced-viewer${needsFill ? " enhanced-viewer--fill" : ""}`}>
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
        trailing={
          <>
            {isMermaidVisual && (
              <>
                <button
                  type="button"
                  className="viewer-toolbar-btn"
                  onClick={() => mermaidRef.current?.exportPng()}
                  aria-label="Export PNG"
                  title="Export diagram as PNG"
                >
                  PNG
                </button>
                <button
                  type="button"
                  className="viewer-toolbar-btn"
                  onClick={() => mermaidRef.current?.exportSvg()}
                  aria-label="Export SVG"
                  title="Export diagram as SVG"
                >
                  SVG
                </button>
              </>
            )}
            <FileActionsBar path={filePath} />
          </>
        }
      />
      {showSource ? (
        <SourceView content={content} path={path} filePath={filePath} fileSize={fileSize} wordWrap={wordWrap} zoom={zoom} />
      ) : (
        <div className="enhanced-viewer-content">
          <Suspense fallback={<SkeletonLoader />}>
            {renderVisualView(category, content, path, filePath, fileSize, zoom, mermaidRef)}
          </Suspense>
        </div>
      )}
    </div>
  );
}

function renderVisualView(
  category: string,
  content: string,
  path: string,
  filePath: string,
  fileSize: number | undefined,
  zoom: number,
  mermaidRef: React.RefObject<MermaidViewHandle | null>,
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
      return <MermaidView ref={mermaidRef} content={content} path={path} zoom={zoom} />;
    case "kql":
      return <KqlPlanView content={content} />;
    default:
      return null;
  }
}
