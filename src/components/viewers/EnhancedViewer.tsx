import { Suspense, lazy, useState, useRef, type ReactNode } from "react";
import { useStore } from "@/store";
import { getFileCategory, hasVisualization, getDefaultView, getFiletypeKey } from "@/lib/file-types";
import { useZoom } from "@/hooks/useZoom";
import { useCtrlWheelZoom } from "@/hooks/useCtrlWheelZoom";
import { MARKDOWN_VISUAL_CAP_BYTES } from "@/lib/viewer-budgets";
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

/**
 * Iter 3 of #252 — markdown soft cap. Files at/above
 * `MARKDOWN_VISUAL_CAP_BYTES` open in source mode and the visual toggle is
 * disabled with a tooltip explaining why. ReactMarkdown parsing of a
 * 1 MB+ document blocks the main thread for many seconds, so source mode
 * (which is virtualised — see iter 2) is the only responsive surface for
 * large markdown.
 */
const MARKDOWN_VISUAL_DISABLED_TOOLTIP = `Markdown rendering is disabled for files ≥ ${Math.round(
  MARKDOWN_VISUAL_CAP_BYTES / 1024
)} KB. Open the source view to read it as text.`;

export function EnhancedViewer({ content, path, filePath, fileSize, centerSlot }: Props) {
  const category = getFileCategory(path);
  const canVisualize = hasVisualization(category);
  const defaultView = getDefaultView(category);
  const [wordWrap, setWordWrap] = useState(false);

  const viewMode = useStore((s) => s.viewModeByTab[filePath]) ?? defaultView;
  const setViewMode = useStore((s) => s.setViewMode);

  // Iter 3 of #252 — markdown soft cap. Clamp to source-mode-only when the
  // file is at/above MARKDOWN_VISUAL_CAP_BYTES. Persisted `viewMode` stays
  // as the user selected it; the clamp is render-time, so the toggle
  // re-enables naturally if the file shrinks below the cap on next open.
  const visualDisabled =
    category === "markdown" && (fileSize ?? 0) >= MARKDOWN_VISUAL_CAP_BYTES;
  const effectiveView: "source" | "visual" = visualDisabled ? "source" : viewMode;

  const handleViewChange = (mode: "source" | "visual") => {
    if (visualDisabled && mode === "visual") return;
    setViewMode(filePath, mode);
  };

  const showSource = effectiveView === "source" || !canVisualize;
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
  //
  // Iter 2 of #252 — source mode also gets `--fill` so `.source-lines` can
  // be the flex-bounded scroll container that drives the @tanstack/react-
  // virtual virtualizer. Without `--fill`, the source list grows past the
  // viewport and the inner overflow:auto never engages, so virtualisation
  // can't measure visible rows.
  const needsFill =
    showSource ||
    (!showSource && (category === "mermaid" || category === "csv" || category === "kql" || category === "html"));

  return (
    <div
      ref={containerRef}
      className={`enhanced-viewer${needsFill ? " enhanced-viewer--fill" : ""}`}
    >
      <ViewerToolbar
        activeView={effectiveView}
        onViewChange={handleViewChange}
        hidden={!canVisualize}
        showWrapToggle={showSource}
        wordWrap={wordWrap}
        onToggleWrap={() => setWordWrap(!wordWrap)}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        centerSlot={centerSlot}
        trailing={<FileActionsBar path={filePath} />}
        visualDisabled={visualDisabled}
        visualDisabledReason={visualDisabled ? MARKDOWN_VISUAL_DISABLED_TOOLTIP : undefined}
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
