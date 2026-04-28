import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId, forwardRef, useImperativeHandle } from "react";
import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Optional file path. When provided, a file-level comment badge is shown. */
  path?: string;
  /** Zoom level from the shared useZoom hook, driven by EnhancedViewer. */
  zoom?: number;
}

/** Handle exposed to EnhancedViewer for toolbar export buttons. */
export interface MermaidViewHandle {
  exportPng: () => void;
  exportSvg: () => void;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map a rendered SVG flowchart node to a 1-based line number in the original
 * mermaid source. Heuristic, in priority order:
 *   1. ID-based: mermaid v10 emits ids like `flowchart-A-1`. Strip the
 *      `flowchart-` prefix and trailing index, then whole-word match the
 *      remaining identifier (e.g. `A`) against each source line.
 *   2. Label text: read the node's `textContent` and substring-match each
 *      source line.
 *   3. Otherwise → null. Caller falls back to a file-level anchor.
 *
 * Limitations: non-flowchart diagrams (sequence, gantt, …) don't follow the
 * `flowchart-X-N` id convention and may not have unique label tokens, so most
 * of their nodes will fall through to the file-level fallback. That is by
 * design — the click handler still fires (no crash), the comment just lacks
 * a precise line anchor.
 */
function mapNodeToSourceLine(node: SVGGElement, lines: string[]): number | null {
  const id = node.id || node.getAttribute("data-id") || "";
  // Mermaid v10/v11 emits ids like `<mermaidId>-flowchart-<source>-<n>` (the
  // leading `<mermaidId>-` is the container's `useId`). Match anywhere in
  // the id with a greedy capture so identifiers containing dashes (e.g.
  // `Some-Name`) survive intact.
  const m = id.match(/-flowchart-(.+)-\d+$/) ?? id.match(/^flowchart-(.+)-\d+$/);
  if (m && m[1]) {
    const re = new RegExp(`\\b${escapeRegExp(m[1])}\\b`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) return i + 1;
    }
  }
  const label = (node.textContent ?? "").trim();
  if (label) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(label)) return i + 1;
    }
  }
  return null;
}

export const MermaidView = forwardRef<MermaidViewHandle, Props>(function MermaidView({ content, path, zoom = 1 }, ref) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const mermaidId = `mermaid-${reactId.replace(/:/g, "")}`;

  const filePath = path ?? null;

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
        const { svg: renderedSvg } = await mermaid.render(mermaidId, content);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Error rendering diagram: ${err instanceof Error ? err.message : String(err)}`);
          setSvg("");
        }
      }
    }
    if (content.trim()) {
      renderDiagram();
    }
    return () => { cancelled = true; };
  }, [content, mermaidId]);

  // Inject the rendered SVG via direct innerHTML rather than React's
  // `dangerouslySetInnerHTML`. The walk effect below mutates attributes on
  // the resulting SVG nodes (`data-source-line`, inline `cursor`); using
  // `dangerouslySetInnerHTML` causes React to re-apply innerHTML on every
  // re-render — even when the svg string hasn't changed — wiping those
  // mutations. Setting it ourselves keeps the DOM stable across renders so
  // attributes set in the walk effect persist.
  // D1 — useLayoutEffect (paired with the walk effect below). Both must
  // run before browser paint and in declaration order, so the SVG is
  // injected first and only then walked. Using `useEffect` here would let
  // the walk run against an empty container.
  useLayoutEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;
    if (svg) {
      wrapper.innerHTML = svg;
    } else {
      wrapper.innerHTML = "";
    }
  }, [svg]);

  // After mermaid emits the SVG, walk it to stamp `data-source-line`
  // attributes for downstream tooling.
  useLayoutEffect(() => {
    if (!filePath) return;
    const wrapper = containerRef.current;
    if (!svg || !wrapper) return;
    const svgEl = wrapper.querySelector("svg");
    if (!svgEl) return;
    const lines = content.split("\n");
    const nodes = Array.from(svgEl.querySelectorAll("g.node")) as SVGGElement[];
    for (const n of nodes) {
      const line = mapNodeToSourceLine(n, lines);
      if (line !== null) n.setAttribute("data-source-line", String(line));
    }
  }, [svg, content, filePath]);

  const handleExportSvg = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [svg]);

  const handleExportPng = useCallback(() => {
    if (!svg) return;
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "diagram.png";
        a.click();
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }, [svg]);

  useImperativeHandle(ref, () => ({
    exportPng: handleExportPng,
    exportSvg: handleExportSvg,
  }), [handleExportPng, handleExportSvg]);

  return (
    <div className="mermaid-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {error && <div className="mermaid-error" style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>{error}</div>}
        {svg && (
          <div
            ref={containerRef}
            title="Mermaid diagram"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          />
        )}
      </div>
    </div>
  );
});
