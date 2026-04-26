import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId, useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import { deriveAnchor, type Anchor } from "@/types/comments";
import { CommentBadge } from "@/components/comments/CommentBadge";
import { CommentInput } from "@/components/comments/CommentInput";
import type { CommentThread as CommentThreadType } from "@/lib/tauri-commands";
import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Optional file path. When omitted, comment-affordance UI is hidden. */
  path?: string;
}

interface NodeOverlay {
  /** 1-based source line, or null when mapping fell through to file-level. */
  line: number | null;
  /** Position relative to the overlay parent (px). */
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ComposerState {
  line: number | null;
  top: number;
  left: number;
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

export function MermaidView({ content, path }: Props) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [scale, setScale] = useState(1);
  const [overlays, setOverlays] = useState<NodeOverlay[]>([]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // Bumped by the ResizeObserver below; an additional dep on the layout
  // effect that walks the SVG so node-overlay rects get recomputed when the
  // container resizes (e.g. window resize, sidebar toggle, font-size change).
  const [layoutTick, setLayoutTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayParentRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const mermaidId = `mermaid-${reactId.replace(/:/g, "")}`;

  const filePath = path ?? null;
  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();
  const setFocusedThread = useStore((s) => s.setFocusedThread);

  // Index unresolved line-anchored threads by line number so we can render
  // a badge over each mapped node.
  const threadsByLine = useMemo(() => {
    const m = new Map<number, CommentThreadType[]>();
    if (!filePath) return m;
    for (const t of threads) {
      if (t.root.resolved) continue;
      const a = deriveAnchor(t.root);
      if (a.kind !== "line") continue;
      const arr = m.get(a.line) ?? [];
      arr.push(t);
      m.set(a.line, arr);
    }
    return m;
  }, [threads, filePath]);

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

  // After mermaid emits the SVG, walk it to (a) stamp `data-source-line`
  // attributes for downstream tooling, (b) attach click handlers that open
  // the inline composer at the clicked node, and (c) collect overlay rects
  // so React-managed badges can be positioned over each node. Re-runs when
  // the SVG changes (new diagram) or the zoom changes (rect coordinates
  // shift). The path-less embed mode skips wiring entirely.
  // The actual setState calls are wrapped in an async IIFE to avoid the
  // react-hooks/set-state-in-effect lint rule (mirrors use-comments.ts).
  // D1 — useLayoutEffect so the SVG walk + position computation runs
  // synchronously before browser paint, eliminating a one-frame flash where
  // overlays appear at stale positions.
  useLayoutEffect(() => {
    let cancelled = false;
    let cleanups: Array<() => void> = [];

    (async () => {
      if (cancelled) return;
      if (!filePath) {
        setOverlays([]);
        return;
      }
      const wrapper = containerRef.current;
      const overlayParent = overlayParentRef.current;
      if (!svg || !wrapper || !overlayParent) {
        setOverlays([]);
        return;
      }
      const svgEl = wrapper.querySelector("svg");
      if (!svgEl) {
        setOverlays([]);
        return;
      }
      const lines = content.split("\n");
      const nodes = Array.from(svgEl.querySelectorAll("g.node")) as SVGGElement[];
      const overlayRect = overlayParent.getBoundingClientRect();
      const nextOverlays: NodeOverlay[] = [];

      for (const n of nodes) {
        const line = mapNodeToSourceLine(n, lines);
        if (line !== null) n.setAttribute("data-source-line", String(line));
        n.style.cursor = "pointer";
        const handler = (e: Event) => {
          e.stopPropagation();
          const parent = overlayParentRef.current;
          if (!parent) return;
          const rect = n.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          setComposer({
            line,
            top: rect.bottom - parentRect.top,
            left: rect.left - parentRect.left,
          });
        };
        n.addEventListener("click", handler);
        cleanups.push(() => n.removeEventListener("click", handler));

        const r = n.getBoundingClientRect();
        nextOverlays.push({
          line,
          top: r.top - overlayRect.top,
          left: r.left - overlayRect.left,
          width: r.width,
          height: r.height,
        });
      }
      if (!cancelled) setOverlays(nextOverlays);
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
      cleanups = [];
    };
  }, [svg, content, scale, filePath, layoutTick]);

  // D1 — observe size changes on the SVG container and bump `layoutTick`
  // so the layout effect above re-walks the SVG and re-computes overlay
  // rects. Without this, resizing the panel leaves badges at stale
  // coordinates until the next zoom/svg change.
  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setLayoutTick((t) => t + 1);
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [svg]);

  const handleComposerSave = useCallback(
    (text: string) => {
      if (!filePath || !composer) return;
      // F1 — emit `kind:"line"` when the heuristic mapped to a source line;
      // omit the anchor (file-level fallback) when mapping returned null.
      // D1 — when we have a mapped source line, also include the matched
      // source-line text (capped at 256 chars) as `selected_text` so the
      // anchor survives line renumbering / re-ordering via fuzzy match in
      // the Rust resolver.
      let anchor: Anchor | undefined;
      if (composer.line !== null) {
        const sourceLine = (content.split("\n")[composer.line - 1] ?? "").slice(0, 256);
        anchor = { kind: "line", line: composer.line, selected_text: sourceLine };
      }
      addComment(filePath, text, anchor).catch(() => {});
      setComposer(null);
    },
    [filePath, composer, addComment, content],
  );

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

  return (
    <div className="mermaid-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="mermaid-toolbar" style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border, #d0d7de)", alignItems: "center" }}>
        <button onClick={() => setScale(s => Math.max(0.25, s - 0.25))} aria-label="Zoom out">−</button>
        <span style={{ fontSize: 12, minWidth: 48, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(4, s + 0.25))} aria-label="Zoom in">+</button>
        <button onClick={() => setScale(1)} aria-label="Reset zoom">Reset</button>
        <div style={{ flex: 1 }} />
        <button onClick={handleExportPng} aria-label="Export PNG">PNG</button>
        <button onClick={handleExportSvg} aria-label="Export SVG">SVG</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {error && <div className="mermaid-error" style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>{error}</div>}
        {svg && (
          <div ref={overlayParentRef} className="mermaid-overlay-parent">
            <div
              ref={containerRef}
              title="Mermaid diagram"
              style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
            {filePath && overlays.map((o, i) => {
              if (o.line === null) return null;
              const ts = threadsByLine.get(o.line) ?? [];
              if (ts.length === 0) return null;
              const firstThreadId = ts[0].root.id;
              return (
                <button
                  key={`badge-${i}`}
                  type="button"
                  className="mermaid-node-badge-btn"
                  style={{
                    position: "absolute",
                    top: o.top,
                    left: o.left + o.width - 8,
                  }}
                  aria-label={`Open ${ts.length} comment${ts.length === 1 ? "" : "s"} on this node`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedThread(firstThreadId);
                  }}
                >
                  <CommentBadge count={ts.length} className="tree-comment-badge" />
                </button>
              );
            })}
            {filePath && composer && (
              <div
                className="mermaid-node-composer"
                style={{ position: "absolute", top: composer.top, left: composer.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <CommentInput
                  onSave={handleComposerSave}
                  onClose={() => setComposer(null)}
                  placeholder="Comment on this node…"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
