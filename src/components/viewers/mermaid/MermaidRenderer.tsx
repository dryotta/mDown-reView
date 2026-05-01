import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { renderMermaid, type MermaidTheme } from "@/lib/mermaid-singleton";
import { useTheme } from "@/hooks/useTheme";
import { warn } from "@/logger";

interface Props {
  content: string;
  /** When provided AND readOnly is false, walks the SVG to stamp `data-source-line` on flowchart nodes. */
  path?: string | null;
  /** When true, skips the data-source-line walk. Used by the popout (read-only). */
  readOnly?: boolean;
  /** Optional callback when SVG injection completes; receives the inserted <svg> element. Used by MermaidCanvas to compute fit-to-window from svg.getBBox(). */
  onSvgReady?: (svg: SVGSVGElement) => void;
}

/** Hard cap on the number of flowchart nodes we walk. Per docs/performance.md
 *  rule 1, every unbounded input must have a hard cap. A diagram with more
 *  than ~5000 nodes is unreadable anyway and walking would dominate paint. */
const NODE_WALK_CAP = 5000;

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
 *
 * Lifted verbatim from MermaidView.tsx as part of the dedicated-viewer split
 * (issue #276). The original copy in MermaidView.tsx is removed when that
 * file is rewritten in the c2-mermaidview wave.
 */
function mapNodeToSourceLine(
  node: SVGGElement,
  lines: string[],
  tokenIndex: Map<string, number>,
): number | null {
  const id = node.id || node.getAttribute("data-id") || "";
  const m = id.match(/-flowchart-(.+)-\d+$/) ?? id.match(/^flowchart-(.+)-\d+$/);
  if (m && m[1]) {
    // Fast path: pre-built token index. Falls through to substring scan
    // only when the id token is not a whole-word match in any line.
    const indexed = tokenIndex.get(m[1]);
    if (indexed !== undefined) return indexed;
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

/**
 * Pure render-primitive for mermaid diagrams. Produces a wrapper div with the
 * rendered <svg> inside, optionally stamping `data-source-line` on flowchart
 * nodes for the dedicated viewer's per-node click-to-comment feature. NO
 * transform / pan / zoom / wheel / pointer logic lives here — that is the
 * caller's responsibility (see MermaidCanvas).
 */
export function MermaidRenderer({ content, path, readOnly, onSvgReady }: Props) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const mermaidId = `mermaid-${reactId.replace(/:/g, "")}`;

  const theme = useTheme();
  const mermaidTheme: MermaidTheme = theme === "dark" ? "dark" : "default";

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      try {
        const { svg: renderedSvg } = await renderMermaid({
          theme: mermaidTheme,
          id: mermaidId,
          content,
        });
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
      void renderDiagram();
    }
    return () => {
      cancelled = true;
    };
  }, [content, mermaidId, mermaidTheme]);

  // Inject the rendered SVG via direct innerHTML rather than React's
  // `dangerouslySetInnerHTML`. The walk effect below mutates attributes on
  // the resulting SVG nodes (`data-source-line`, inline `cursor`); using
  // `dangerouslySetInnerHTML` causes React to re-apply innerHTML on every
  // re-render — even when the svg string hasn't changed — wiping those
  // mutations. Setting it ourselves keeps the DOM stable across renders so
  // attributes set in the walk effect persist.
  // useLayoutEffect (paired with the walk effect below). Both must run
  // before browser paint and in declaration order, so the SVG is injected
  // first and only then walked. Using `useEffect` here would let the walk
  // run against an empty container.
  useLayoutEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;
    wrapper.innerHTML = svg ?? "";
    if (svg) {
      const svgEl = wrapper.querySelector("svg");
      if (svgEl) onSvgReady?.(svgEl as SVGSVGElement);
    }
  }, [svg, onSvgReady]);

  // After mermaid emits the SVG, walk it to stamp `data-source-line`
  // attributes for downstream tooling (per-node click-to-comment).
  useLayoutEffect(() => {
    if (!path || readOnly) return;
    const wrapper = containerRef.current;
    if (!svg || !wrapper) return;
    const svgEl = wrapper.querySelector("svg");
    if (!svgEl) return;
    const lines = content.split("\n");
    // Pre-build a token→line index. The original implementation in
    // MermaidView.tsx scanned every line for every node (O(N×L)); this drops
    // it to O(L+N) in the common case where the id token matches a whole
    // word on a single line. We index by whole-word splits, mirroring the
    // RegExp(`\\b${token}\\b`) used by the fallback path.
    const tokenIndex = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const tokens = lines[i].split(/[^A-Za-z0-9_]+/);
      for (const t of tokens) {
        if (t && !tokenIndex.has(t)) tokenIndex.set(t, i + 1);
      }
    }
    const nodes = svgEl.querySelectorAll("g.node");
    // Hard cap on walk size per docs/performance.md rule 1. A diagram with
    // > 5000 nodes is unreadable; keep paint bounded.
    const limit = Math.min(nodes.length, NODE_WALK_CAP);
    if (nodes.length > NODE_WALK_CAP) {
      // Fire-and-forget: warn() is async (tauri-plugin-log IPC) but we're
      // running inside a layout effect — we can't await. Errors are
      // non-essential telemetry.
      void warn(`[mermaid] node walk capped at ${NODE_WALK_CAP}`);
    }
    for (let i = 0; i < limit; i++) {
      const n = nodes[i] as SVGGElement;
      const line = mapNodeToSourceLine(n, lines, tokenIndex);
      if (line !== null) n.setAttribute("data-source-line", String(line));
    }
  }, [svg, content, path, readOnly]);

  // The ref'd inner div is fully imperative — its children are managed by
  // the innerHTML write above. The error message renders as a sibling React
  // child so React's reconciler never fights the imperative DOM. Mixing
  // JSX children with `innerHTML` on the same element would let the layout
  // effect blow away React-rendered nodes (and vice-versa).
  return (
    <div title="Mermaid diagram" className="mermaid-renderer">
      <div ref={containerRef} />
      {error ? <div className="mermaid-error">{error}</div> : null}
    </div>
  );
}
