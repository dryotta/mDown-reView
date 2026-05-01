import { MermaidCanvas } from "./mermaid/MermaidCanvas";

import { useStore } from "@/store";

import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Optional file path; when provided, MermaidRenderer stamps data-source-line for click-to-comment. */
  path?: string;
  /** Per-filetype zoom from EnhancedViewer's useZoom('.mmd'). 1.0 = "fits the viewing area". */
  zoom?: number;
}

/**
 * Slim shell for the dedicated `.mmd` viewer (issue #276 — c2-mermaidview).
 *
 * Render + theme + transform + pan/zoom now live in MermaidCanvas (which
 * composes MermaidRenderer). This file only owns wiring the shared `.mmd`
 * zoom (via `useStore`) into MermaidCanvas. The dedicated viewer itself
 * renders no inline chrome — zoom + reset live in the chrome
 * ViewerToolbar (single source of truth via `useZoom`), and the Pop-out
 * affordance lives ONLY on the markdown-embedded path
 * (`MermaidEmbedded`'s hover button) where it's the only way to enlarge
 * a tiny embedded diagram. The dedicated viewer already IS the full-
 * window view, so a Pop-out button there would be a no-op.
 */
export function MermaidView({ content, path, zoom = 1 }: Props) {
  const setZoom = useStore((s) => s.setZoom);

  return (
    <div
      className="mermaid-view"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <MermaidCanvas
        content={content}
        path={path ?? null}
        zoom={zoom}
        setZoom={(v) => setZoom(".mmd", v)}
        readOnly={false}
      />
    </div>
  );
}
