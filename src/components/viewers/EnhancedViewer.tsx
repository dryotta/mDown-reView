import { Suspense, lazy, useEffect, useState, useRef, type ReactNode } from "react";
import { useStore } from "@/store";
import { getFileCategory, hasVisualization, getDefaultView, getFiletypeKey, isExcalidrawLibrary, type ViewMode } from "@/lib/file-types";
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
const LazyExcalidrawView = lazy(() =>
  import("./ExcalidrawView").then((m) => ({ default: m.ExcalidrawView }))
);
// Issue #352 / iter-4 AC2 — Source mode for `.excalidraw.png` / `.excalidraw.svg`
// runs `extractScene` (which lives in the same lazy chunk as `ExcalidrawView`)
// and feeds pretty-printed JSON to `SourceView`. Lazy so the main bundle
// stays excalidraw-free until first PNG/SVG-source view.
const LazyExcalidrawSourceMode = lazy(() =>
  import("./ExcalidrawSourceMode").then((m) => ({ default: m.ExcalidrawSourceMode }))
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
   * `.claude/agents/react-coding-expert/knowledge/react-composition-patterns.md`.
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
  const defaultView = getDefaultView(category, path);
  const isExcalidraw = category === "excalidraw";
  const [wordWrap, setWordWrap] = useState(false);

  const viewMode = useStore((s) => s.viewModeByTab[filePath]) ?? defaultView;
  const setViewMode = useStore((s) => s.setViewMode);
  const markExcalidrawEditorMounted = useStore((s) => s.markExcalidrawEditorMounted);
  // Issue #352 / iter-13 — when this path is registered for persistent
  // mounting, the `<PersistentExcalidrawHost>` (rendered in App.tsx as
  // a sibling of ViewerRouter) owns the `<ExcalidrawView>` instance.
  // We MUST NOT also mount it locally, or the user would see two
  // overlapping canvases (and Excalidraw would create two
  // `excalidrawAPI` instances racing for the same path).
  const isPersistentlyMounted = useStore((s) =>
    s.excalidrawEditorMounts.includes(filePath),
  );
  // Issue #352 / iter-5 BLOCKER (product B2) — read-only tabs (outside
  // the workspace) cannot route through the workspace-write IPC. Hide
  // the Editor segmented-control button + demote stored editor mode
  // to visual for these tabs. The Save button itself lives in the top
  // app toolbar (see `App.tsx`); per-viewer toolbar carries no save
  // affordance any more.
  const isReadOnly = useStore(
    (s) => s.tabs.find((t) => t.path === filePath)?.readOnly === true,
  );

  // Iter 3 of #252 — markdown soft cap. Clamp to source-mode-only when
  // the file is at/above MARKDOWN_VISUAL_CAP_BYTES. Persisted `viewMode`
  // stays as the user selected it; the clamp is render-time, so the
  // toggle re-enables naturally if the file shrinks below the cap on
  // next open.
  const visualDisabled =
    category === "markdown" && (fileSize ?? 0) >= MARKDOWN_VISUAL_CAP_BYTES;

  const handleViewChange = (mode: ViewMode) => {
    if (visualDisabled && mode !== "source") return;
    setViewMode(filePath, mode);
  };

  // Iter-22 redesign (user feedback) — `.excalidrawlib` files are
  // view-only. Libraries are reusable shape collections, not documents
  // authored line-by-line; the Editor segmented-control button and any
  // stored `editor` mode are demoted to Visual for these paths. The
  // library sidebar stays open in Visual mode (driven by
  // `appState.openSidebar` in `useExcalidrawScene`) so the user can
  // browse the curated shapes without entering the editor.
  const isLibrary = isExcalidraw && isExcalidrawLibrary(filePath);

  // Effective view mode after visualisability gating: a non-visualisable
  // category (or a viewer whose Visual/Editor pane is disabled) always
  // falls back to source. The 3-way switch below routes off this resolved
  // value so future categories don't have to repeat the gate. Read-only
  // excalidraw tabs are demoted from editor → visual since saving is
  // impossible; user can still inspect the canvas read-only. Library
  // tabs are demoted unconditionally — editor mode is unreachable
  // (post-iter-22 redesign).
  const effectiveView: ViewMode = visualDisabled
    ? "source"
    : canVisualize
      ? viewMode === "editor" && (isReadOnly || isLibrary)
        ? "visual"
        : viewMode
      : "source";
  const showSource = effectiveView === "source";

  // Iter-14 (bug-expert LOW — double-mount race fix): the host should own
  // the slot from the SAME render that decides "this is an Excalidraw
  // editor". Without this, render N sees `isPersistentlyMounted=false`
  // (store not yet updated) → mounts a local `<ExcalidrawView>`; the
  // post-commit effect then fires `markExcalidrawEditorMounted` →
  // render N+1 the host's slot mounts AND the local one unmounts. For
  // one paint two `<Excalidraw>` instances co-exist for the same path.
  // Computing `excalidrawHostOwns` purely from props/store at render
  // time guarantees the local mount path is never taken once the
  // current view is Editor; the host's slot will mount after the
  // effect commits the store entry, but in the interim the local
  // path renders only the placeholder.
  const excalidrawHostOwns =
    isExcalidraw && (isPersistentlyMounted || effectiveView === "editor");

  // Issue #352 / iter-13 — register the path for persistent mounting
  // whenever an Excalidraw editor renders in Editor mode. Driven by an
  // effect (not the click handler) so that:
  //   - a tab restored at Editor mode via session-persisted state, OR
  //   - back/forward navigation that lands in Editor mode without a
  //     mode-toggle click,
  // both still register. Idempotent — the store setter short-circuits
  // on duplicate marks, so re-renders cost nothing.
  useEffect(() => {
    if (!isExcalidraw) return;
    if (effectiveView !== "editor") return;
    markExcalidrawEditorMounted(filePath);
  }, [filePath, isExcalidraw, effectiveView, markExcalidrawEditorMounted]);

  // Zoom key tracks the active sub-view so source-mode zoom is independent of
  // visual-mode zoom for the same document (#65 D1/D2/D3). Visual and Editor
  // share the same zoom key for excalidraw — both are canvas surfaces.
  const filetypeKey = getFiletypeKey(path, effectiveView);
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
    (!showSource &&
      (category === "mermaid" ||
        category === "csv" ||
        category === "kql" ||
        category === "html" ||
        category === "excalidraw"));

  return (
    <div
      ref={containerRef}
      className={`enhanced-viewer${needsFill ? " enhanced-viewer--fill" : ""}`}
    >
      <ViewerToolbar
        activeView={effectiveView}
        onViewChange={handleViewChange}
        canEdit={isExcalidraw && !isReadOnly && !isLibrary}
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
        // Issue #352 / iter-4 AC2 — for `.excalidraw.png` / `.excalidraw.svg`
        // Source mode shows the EXTRACTED scene JSON, not the raw binary
        // bytes. Routing happens here (not in `SourceView`) so the lazy
        // `extractScene` import only fires when a PNG/SVG source view
        // actually renders.
        isExcalidraw &&
        (path.toLowerCase().endsWith(".excalidraw.png") ||
          path.toLowerCase().endsWith(".excalidraw.svg")) ? (
          <Suspense fallback={<SkeletonLoader />}>
            <LazyExcalidrawSourceMode
              key={filePath}
              filePath={filePath}
              fileSize={fileSize}
              wordWrap={wordWrap}
              zoom={zoom}
              // Trick the syntax highlighter into using JSON.
              syntaxPath={`${path}.json`}
            />
          </Suspense>
        ) : (
          <SourceView content={content} path={path} filePath={filePath} fileSize={fileSize} wordWrap={wordWrap} zoom={zoom} />
        )
      ) : (
        <div className="enhanced-viewer-content">
          <Suspense fallback={<SkeletonLoader />}>
            {renderVisualView(
              category,
              content,
              path,
              filePath,
              fileSize,
              zoom,
              effectiveView,
              excalidrawHostOwns,
            )}
            {/* renderVisualView keys excalidraw on filePath to satisfy AC10 (key={path}) */}
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
  viewMode: ViewMode,
  /**
   * Issue #352 / iter-13 — when an Excalidraw editor is persistently
   * mounted (path in `excalidrawEditorMounts`), the
   * `<PersistentExcalidrawHost>` (rendered in `App.tsx`) owns the
   * `<ExcalidrawView>` instance. EnhancedViewer renders an empty
   * placeholder div in its content area; the host's slot overlays it.
   * This avoids two parallel `<Excalidraw>` instances racing for the
   * same path's scene state.
   */
  excalidrawHostOwns: boolean,
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
    case "excalidraw": {
      // Iter-13: when the host owns this path, return a transparent
      // placeholder. The host's absolutely-positioned slot occupies
      // the same viewer area; the local content area stays empty and
      // gives the host its layout context (parent
      // `.enhanced-viewer-content` flex sizing).
      if (excalidrawHostOwns) {
        return (
          <div
            className="excalidraw-host-placeholder"
            data-testid="excalidraw-host-placeholder"
            data-path={filePath}
            style={{ width: "100%", height: "100%" }}
          />
        );
      }
      // Iter-2 (issue #352) — lazy `<ExcalidrawView/>` mounts here for
      // ephemeral (non-persistent) usage: a tab the user has only ever
      // viewed in Visual mode. PNG / SVG variants need scene extraction
      // from binary file bytes; canonical `.excalidraw` / `.excalidrawlib`
      // ship the scene as JSON text in `content`. `needsExtract` flips
      // between those paths. `viewMode` is "source" | "visual" |
      // "editor", but Source is rendered above by `<SourceView/>` — we
      // only see "visual" or "editor" here.
      const lower = path.toLowerCase();
      const needsExtract =
        lower.endsWith(".excalidraw.png") || lower.endsWith(".excalidraw.svg");
      return (
        <LazyExcalidrawView
          key={filePath}
          content={content}
          filePath={filePath}
          mode={viewMode === "editor" ? "editor" : "visual"}
          needsExtract={needsExtract}
        />
      );
    }
    default:
      return null;
  }
}
