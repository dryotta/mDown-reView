import { Suspense, lazy } from "react";
import { useStore } from "@/store";
import { getFileCategory, hasVisualization, getDefaultView } from "@/lib/file-types";
import { ViewerToolbar } from "./ViewerToolbar";
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
}

export function EnhancedViewer({ content, path, filePath, fileSize }: Props) {
  const category = getFileCategory(path);
  const canVisualize = hasVisualization(category);
  const defaultView = getDefaultView(category);

  const viewMode = useStore((s) => s.viewModeByTab[filePath]) ?? defaultView;
  const setViewMode = useStore((s) => s.setViewMode);

  const handleViewChange = (mode: "source" | "visual") => {
    setViewMode(filePath, mode);
  };

  const showSource = viewMode === "source" || !canVisualize;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewerToolbar
        activeView={viewMode}
        onViewChange={handleViewChange}
        hidden={!canVisualize}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        {showSource ? (
          <SourceView content={content} path={path} filePath={filePath} fileSize={fileSize} />
        ) : (
          <Suspense fallback={<SkeletonLoader />}>
            {renderVisualView(category, content, path, filePath, fileSize)}
          </Suspense>
        )}
      </div>
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
      return <JsonTreeView content={content} />;
    case "csv":
      return <CsvTableView content={content} path={path} />;
    case "html":
      return <HtmlPreviewView content={content} />;
    case "mermaid":
      return <MermaidView content={content} />;
    case "kql":
      return <KqlPlanView content={content} />;
    default:
      return null;
  }
}
