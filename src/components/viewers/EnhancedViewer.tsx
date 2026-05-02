import { Suspense, lazy, useState, useRef, type ReactNode } from "react";
import { useStore } from "@/store";
import { getFileCategory, hasVisualization, getDefaultView, getFiletypeKey } from "@/lib/file-types";
import { useZoom } from "@/hooks/useZoom";
import { useCtrlWheelZoom } from "@/hooks/useCtrlWheelZoom";
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
  /**
   * G4 — composition slot forwarded to `ViewerToolbar.centerSlot`. Callers
   * typically pass `<ToolbarFileCommentPill ... />`. See
   * `patterns-children-over-render-props` in
   * `docs/best-practices-common/react/composition-patterns.md`.
   */
  centerSlot?: ReactNode;
}

export function EnhancedViewer({ content, path, filePath, fileSize, centerSlot }: Props) {
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

  // Ctrl+wheel (Cmd+wheel on macOS) drives the zoom controller. Listener is
  // attached at the EnhancedViewer root so wheel events from any descendant
  // (SourceView, MarkdownViewer, JsonTreeView, CsvTableView, MermaidView,
  // KqlPlanView, the HtmlPreview banner) bubble up. The HTML preview iframe
  // installs its own listener inside `contentDocument` because wheel events
  // inside an iframe do not bubble to the parent frame.
  const containerRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(containerRef, zoomIn, zoomOut);

  // Categories whose visual view must fill the viewport (not scroll with
  // content). These get `enhanced-viewer--fill` which adds `height: 100%`
  // so children can resolve percentage heights.
  const needsFill = !showSource && (category === "mermaid" || category === "csv" || category === "kql" || category === "html");

  return (
    <div
      ref={containerRef}
      className={`enhanced-viewer${needsFill ? " enhanced-viewer--fill" : ""}`}
    >
      <ViewerToolbar
        activeView={viewMode}
        onViewChange={handleViewChange}
        hidden={!canVisualize}
        showWrapToggle={showSource}
        wordWrap={wordWrap}
        onToggleWrap={() => setWordWrap(!wordWrap)}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        centerSlot={centerSlot}
        trailing={<FileActionsBar path={filePath} />}
      />
      {showSource ? (
        <SourceView content={content} path={path} filePath={filePath} fileSize={fileSize} wordWrap={wordWrap} zoom={zoom} />
      ) : (
        <div className="enhanced-viewer-content">
          <Suspense fallback={<SkeletonLoader />}>
            {renderVisualView(category, content, path, filePath, fileSize, zoom)}
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
      return <MermaidView content={content} path={path} zoom={zoom} />;
    case "kql":
      return <KqlPlanView content={content} />;
    default:
      return null;
  }
}
