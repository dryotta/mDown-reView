import { useCallback } from "react";
import { MermaidRenderer } from "./MermaidRenderer";
import { useStore } from "@/store";
import "@/styles/mermaid-popout.css";

interface Props {
  content: string;
}

/**
 * Embedded mermaid block renderer used inside markdown documents (issue #276).
 *
 * Wraps {@link MermaidRenderer} in a `.mermaid-embedded` positioning context
 * with a hover-revealed pop-out button (top-right). NO transform / pan / zoom
 * shell — embedded blocks render at the diagram's natural size per spec.
 *
 * Note: we deliberately do NOT pass a `path` prop to the renderer. Source-line
 * stamping on embedded mermaid is markdown-line-relative (not mermaid-source-
 * line-relative) and was never wired in the original MermaidEmbed; preserving
 * that behaviour here means the renderer skips the `data-source-line` walk.
 */
export function MermaidEmbedded({ content }: Props) {
  const handleClick = useCallback(() => {
    useStore.getState().openMermaidPopout(content);
  }, [content]);

  return (
    <div className="mermaid-embedded">
      <MermaidRenderer content={content} />
      <button
        type="button"
        className="mermaid-embedded__popout-btn"
        title="Pop out diagram"
        aria-label="Pop out diagram"
        onClick={handleClick}
      >
        ⤢
      </button>
    </div>
  );
}
